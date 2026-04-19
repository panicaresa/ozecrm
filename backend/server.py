from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("oze-crm")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
ACCESS_TTL_HOURS = 24 * 7

app = FastAPI(title="OZE CRM API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": now() + timedelta(hours=ACCESS_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def serialize_user(u: Dict[str, Any]) -> Dict[str, Any]:
    if not u:
        return u
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "role": u["role"],
        "avatar_url": u.get("avatar_url"),
        "manager_id": u.get("manager_id"),
        "created_at": iso(u.get("created_at")),
    }


async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_roles(*roles: str):
    async def checker(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Forbidden: insufficient role")
        return user

    return checker


ROLES = ("admin", "manager", "handlowiec")
LEAD_STATUSES = ("umowione", "decyzja", "podpisana", "nie_zainteresowany", "nowy")
DOC_TYPES = ("umowa", "photo", "other")
MAX_DOC_BYTES = 12 * 1024 * 1024  # ~12MB cap on base64 payload


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str
    manager_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    manager_id: Optional[str] = None
    password: Optional[str] = None


class LeadIn(BaseModel):
    client_name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    note: Optional[str] = None
    status: str = "nowy"
    photo_base64: Optional[str] = None
    building_area: Optional[float] = None
    building_type: Optional[str] = None
    assigned_to: Optional[str] = None


class LeadUpdate(BaseModel):
    client_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    note: Optional[str] = None
    status: Optional[str] = None
    photo_base64: Optional[str] = None
    building_area: Optional[float] = None
    building_type: Optional[str] = None
    assigned_to: Optional[str] = None


class SettingsIn(BaseModel):
    base_price_low: float = 275.0
    base_price_high: float = 200.0
    default_margin: float = 10000.0
    default_discount: float = 2000.0
    default_subsidy: float = 20000.0
    default_months: int = 119
    commission_percent: float = 50.0  # % marży globalnej trafia do handlowca
    margin_per_m2: float = 50.0  # bazowy szacunkowy % marży na m² (do widgetu prowizji)
    rrso_rates: List[Dict[str, Any]] = Field(default_factory=list)
    excluded_zip_codes: List[str] = Field(default_factory=list)
    company_name: str = "Polska Grupa OZE Sp. z o.o."
    company_address: str = "ul. Grunwaldzka 415"
    company_zip: str = "80-309 Gdańsk"
    company_nip: str = "NIP: 732-219-77-56"
    company_email: str = "biuro@grupaoze.pl"
    company_phone: str = "+48 509-274-365"


class GoalIn(BaseModel):
    user_id: str
    target: int
    period: str = "monthly"


class DocumentIn(BaseModel):
    type: str = "photo"  # umowa | photo | other
    filename: Optional[str] = None
    mime: Optional[str] = "image/jpeg"
    data_base64: str  # may include data: prefix


class RepLocationIn(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    battery: Optional[float] = None  # 0..1
    battery_state: Optional[str] = None  # charging|unplugged|full|unknown


@api.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Niepoprawny email lub hasło")
    token = create_access_token(user["id"], user["email"], user["role"])
    return {"access_token": token, "token_type": "bearer", "user": serialize_user(user)}


@api.get("/auth/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return serialize_user(user)


@api.post("/auth/register")
async def register(body: RegisterIn, admin: Dict[str, Any] = Depends(require_roles("admin"))):
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Użytkownik o takim e-mailu już istnieje")
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": body.role,
        "manager_id": body.manager_id,
        "avatar_url": None,
        "created_at": now(),
    }
    await db.users.insert_one(user_doc)
    return serialize_user(user_doc)


@api.get("/users")
async def list_users(user: Dict[str, Any] = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if user["role"] == "manager":
        query = {"$or": [{"manager_id": user["id"]}, {"id": user["id"]}]}
    elif user["role"] == "handlowiec":
        query = {"id": user["id"]}
    docs = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(500)
    return [serialize_user(d) for d in docs]


@api.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin: Dict[str, Any] = Depends(require_roles("admin"))):
    updates: Dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        updates["role"] = body.role
    if body.manager_id is not None:
        updates["manager_id"] = body.manager_id
    if body.password:
        updates["password_hash"] = hash_password(body.password)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.users.update_one({"id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return serialize_user(doc)


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: Dict[str, Any] = Depends(require_roles("admin"))):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


@api.get("/leads")
async def list_leads(user: Dict[str, Any] = Depends(get_current_user)):
    if user["role"] == "admin":
        q: Dict[str, Any] = {}
    elif user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = [r["id"] for r in reps] + [user["id"]]
        q = {"$or": [{"assigned_to": {"$in": rep_ids}}, {"owner_manager_id": user["id"]}]}
    else:
        q = {"assigned_to": user["id"]}
    docs = await db.leads.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for d in docs:
        d["created_at"] = iso(d.get("created_at"))
        d["updated_at"] = iso(d.get("updated_at"))
    return docs


@api.post("/leads")
async def create_lead(body: LeadIn, user: Dict[str, Any] = Depends(get_current_user)):
    if body.status not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    lead_id = str(uuid.uuid4())
    assigned = body.assigned_to or (user["id"] if user["role"] == "handlowiec" else None)
    owner_manager = None
    if user["role"] == "manager":
        owner_manager = user["id"]
    elif user["role"] == "handlowiec" and user.get("manager_id"):
        owner_manager = user["manager_id"]
    doc = body.dict()
    doc.update(
        {
            "id": lead_id,
            "assigned_to": assigned,
            "owner_manager_id": owner_manager,
            "created_by": user["id"],
            "created_at": now(),
            "updated_at": now(),
        }
    )
    await db.leads.insert_one(doc)
    out = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    out["created_at"] = iso(out.get("created_at"))
    out["updated_at"] = iso(out.get("updated_at"))
    return out


@api.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate, user: Dict[str, Any] = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if user["role"] == "handlowiec" and lead.get("assigned_to") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your lead")
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = {r["id"] for r in reps} | {user["id"]}
        if lead.get("owner_manager_id") != user["id"] and lead.get("assigned_to") not in rep_ids:
            raise HTTPException(status_code=403, detail="Not your team's lead")
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if "status" in updates and updates["status"] not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    updates["updated_at"] = now()
    await db.leads.update_one({"id": lead_id}, {"$set": updates})
    out = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    out["created_at"] = iso(out.get("created_at"))
    out["updated_at"] = iso(out.get("updated_at"))
    return out


@api.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, user: Dict[str, Any] = Depends(require_roles("admin", "manager"))):
    await db.leads.delete_one({"id": lead_id})
    return {"ok": True}


async def _ensure_lead_access(lead_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if user["role"] == "admin":
        return lead
    if user["role"] == "handlowiec":
        if lead.get("assigned_to") != user["id"]:
            raise HTTPException(status_code=403, detail="Not your lead")
        return lead
    # manager
    reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
    rep_ids = {r["id"] for r in reps} | {user["id"]}
    if lead.get("owner_manager_id") != user["id"] and lead.get("assigned_to") not in rep_ids:
        raise HTTPException(status_code=403, detail="Not your team's lead")
    return lead


@api.post("/leads/{lead_id}/documents")
async def add_document(lead_id: str, body: DocumentIn, user: Dict[str, Any] = Depends(get_current_user)):
    await _ensure_lead_access(lead_id, user)
    if body.type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document type")
    data = body.data_base64 or ""
    # quick size check on raw base64 string
    if len(data) > int(MAX_DOC_BYTES * 1.4):
        raise HTTPException(status_code=413, detail="Dokument jest zbyt duży (>12MB)")
    doc = {
        "id": str(uuid.uuid4()),
        "type": body.type,
        "filename": body.filename or f"{body.type}-{int(datetime.now(timezone.utc).timestamp())}",
        "mime": body.mime or "image/jpeg",
        "data_base64": data,
        "uploaded_by": user["id"],
        "uploaded_at": now(),
    }
    await db.leads.update_one(
        {"id": lead_id},
        {"$push": {"documents": doc}, "$set": {"updated_at": now()}},
    )
    # Return without data_base64 to keep response small
    return {"id": doc["id"], "type": doc["type"], "filename": doc["filename"], "mime": doc["mime"], "uploaded_at": iso(doc["uploaded_at"])}


@api.get("/leads/{lead_id}/documents")
async def list_documents(lead_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    lead = await _ensure_lead_access(lead_id, user)
    docs = lead.get("documents", []) or []
    # Return light metadata list
    return [
        {
            "id": d["id"],
            "type": d["type"],
            "filename": d.get("filename"),
            "mime": d.get("mime"),
            "uploaded_by": d.get("uploaded_by"),
            "uploaded_at": iso(d.get("uploaded_at")),
        }
        for d in docs
    ]


@api.get("/leads/{lead_id}/documents/{doc_id}")
async def get_document(lead_id: str, doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    lead = await _ensure_lead_access(lead_id, user)
    for d in lead.get("documents", []) or []:
        if d["id"] == doc_id:
            return {
                "id": d["id"],
                "type": d["type"],
                "filename": d.get("filename"),
                "mime": d.get("mime"),
                "data_base64": d.get("data_base64"),
                "uploaded_at": iso(d.get("uploaded_at")),
            }
    raise HTTPException(status_code=404, detail="Document not found")


@api.delete("/leads/{lead_id}/documents/{doc_id}")
async def delete_document(lead_id: str, doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    await _ensure_lead_access(lead_id, user)
    res = await db.leads.update_one({"id": lead_id}, {"$pull": {"documents": {"id": doc_id}}, "$set": {"updated_at": now()}})
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# --------------------------------------------------------------------------------------
# Rep live location
# --------------------------------------------------------------------------------------
@api.put("/rep/location")
async def push_rep_location(body: RepLocationIn, user: Dict[str, Any] = Depends(require_roles("handlowiec", "manager", "admin"))):
    doc = {
        "user_id": user["id"],
        "latitude": body.latitude,
        "longitude": body.longitude,
        "accuracy": body.accuracy,
        "battery": body.battery,
        "battery_state": body.battery_state,
        "updated_at": now(),
    }
    await db.rep_locations.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.delete("/rep/location")
async def stop_rep_tracking(user: Dict[str, Any] = Depends(require_roles("handlowiec", "manager", "admin"))):
    await db.rep_locations.delete_one({"user_id": user["id"]})
    return {"ok": True}


DEFAULT_RRSO = [
    {"label": "Alior", "value": 8.85},
    {"label": "Santander", "value": 10.75},
    {"label": "Inbank", "value": 13.42},
    {"label": "Cofidis", "value": 11.9},
]


@api.get("/settings")
async def get_settings(user: Dict[str, Any] = Depends(get_current_user)):
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not doc:
        doc = SettingsIn(rrso_rates=DEFAULT_RRSO, excluded_zip_codes=["77-400"]).dict()
        doc["id"] = "global"
        await db.settings.insert_one(doc)
        doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    return doc


@api.put("/settings")
async def update_settings(body: SettingsIn, admin: Dict[str, Any] = Depends(require_roles("admin"))):
    data = body.dict()
    data["id"] = "global"
    data["updated_at"] = now()
    await db.settings.update_one({"id": "global"}, {"$set": data}, upsert=True)
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0})
    doc["updated_at"] = iso(doc.get("updated_at"))
    return doc


@api.get("/goals")
async def list_goals(user: Dict[str, Any] = Depends(get_current_user)):
    if user["role"] == "handlowiec":
        q = {"user_id": user["id"]}
    elif user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        ids = [r["id"] for r in reps] + [user["id"]]
        q = {"user_id": {"$in": ids}}
    else:
        q = {}
    docs = await db.goals.find(q, {"_id": 0}).to_list(500)
    return docs


@api.put("/goals")
async def set_goal(body: GoalIn, user: Dict[str, Any] = Depends(require_roles("admin", "manager"))):
    await db.goals.update_one(
        {"user_id": body.user_id, "period": body.period},
        {"$set": {**body.dict(), "updated_at": now()}, "$setOnInsert": {"id": str(uuid.uuid4())}},
        upsert=True,
    )
    out = await db.goals.find_one({"user_id": body.user_id, "period": body.period}, {"_id": 0})
    out["updated_at"] = iso(out.get("updated_at"))
    return out


@api.get("/dashboard/manager")
async def manager_dashboard(user: Dict[str, Any] = Depends(require_roles("manager", "admin"))):
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"], "role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
    else:
        reps = await db.users.find({"role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
    rep_ids = [r["id"] for r in reps]

    if user["role"] == "admin":
        lead_query: Dict[str, Any] = {}
    else:
        lead_query = {"$or": [{"assigned_to": {"$in": rep_ids}}, {"owner_manager_id": user["id"]}]}
    leads = await db.leads.find(lead_query, {"_id": 0}).to_list(5000)

    meetings = sum(1 for l in leads if l.get("status") == "umowione")
    new_leads = sum(1 for l in leads if l.get("status") == "nowy")
    quotes = sum(1 for l in leads if l.get("status") in ("decyzja", "podpisana"))
    active_reps = len(reps)

    buckets = {s: 0 for s in LEAD_STATUSES}
    for l in leads:
        s = l.get("status", "nowy")
        if s in buckets:
            buckets[s] += 1

    goals = await db.goals.find({"user_id": {"$in": rep_ids}}, {"_id": 0}).to_list(500)
    goal_map = {g["user_id"]: g for g in goals}
    rep_progress = []
    for r in reps:
        signed = sum(1 for l in leads if l.get("assigned_to") == r["id"] and l.get("status") == "podpisana")
        total = sum(1 for l in leads if l.get("assigned_to") == r["id"])
        target = goal_map.get(r["id"], {}).get("target", 10)
        rep_progress.append(
            {
                "user_id": r["id"],
                "name": r.get("name", r["email"]),
                "email": r["email"],
                "avatar_url": r.get("avatar_url"),
                "signed": signed,
                "total_leads": total,
                "target": target,
                "percent": round((signed / target) * 100) if target else 0,
            }
        )
    top3 = sorted(rep_progress, key=lambda x: (x["signed"], x["percent"]), reverse=True)[:3]

    pins = [
        {
            "id": l["id"],
            "lat": l.get("latitude"),
            "lng": l.get("longitude"),
            "status": l.get("status"),
            "client_name": l.get("client_name"),
        }
        for l in leads
        if l.get("latitude") is not None and l.get("longitude") is not None
    ]

    # Live rep positions
    reps_live_raw = await db.rep_locations.find({"user_id": {"$in": rep_ids}}, {"_id": 0}).to_list(500)
    rep_by_id = {r["id"]: r for r in reps}
    now_ts = now()
    reps_live = []
    for rl in reps_live_raw:
        u = rep_by_id.get(rl["user_id"])
        if not u:
            continue
        ts = rl.get("updated_at")
        last_seen_s = None
        active = True
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            delta = (now_ts - ts).total_seconds()
            last_seen_s = int(delta)
            active = delta < 30 * 60
        reps_live.append(
            {
                "user_id": u["id"],
                "name": u.get("name") or u["email"],
                "avatar_url": u.get("avatar_url"),
                "lat": rl["latitude"],
                "lng": rl["longitude"],
                "battery": rl.get("battery"),
                "battery_state": rl.get("battery_state"),
                "accuracy": rl.get("accuracy"),
                "last_seen_seconds": last_seen_s,
                "active": active,
                "updated_at": iso(ts),
            }
        )

    return {
        "kpi": {"meetings": meetings, "new_leads": new_leads, "quotes": quotes, "active_reps": sum(1 for r in reps_live if r["active"]) or len(reps)},
        "status_breakdown": buckets,
        "rep_progress": rep_progress,
        "top3": top3,
        "pins": pins,
        "reps_live": reps_live,
        "total_leads": len(leads),
    }


@api.get("/dashboard/rep")
async def rep_dashboard(user: Dict[str, Any] = Depends(require_roles("handlowiec", "manager", "admin"))):
    uid = user["id"]
    leads = await db.leads.find({"assigned_to": uid}, {"_id": 0}).to_list(2000)
    signed = sum(1 for l in leads if l.get("status") == "podpisana")
    meetings = sum(1 for l in leads if l.get("status") == "umowione")
    goal = await db.goals.find_one({"user_id": uid, "period": "monthly"}, {"_id": 0})
    target = goal.get("target", 10) if goal else 10
    return {
        "total_leads": len(leads),
        "signed": signed,
        "meetings": meetings,
        "target": target,
        "percent": round((signed / target) * 100) if target else 0,
    }


# --------------------------------------------------------------------------------------
# Finance dashboard — aggregates signed-contracts revenue & commissions
# Formulas mirror frontend CommissionCalculator + offerEngine:
#   base_rate_per_m2 = base_price_low if area <= 200 else base_price_high
#   base_netto       = area * base_rate_per_m2
#   margin_netto     = area * margin_per_m2         (default; per-lead override via lead.margin_override)
#   total_netto      = base_netto + margin_netto
#   VAT:
#     gospodarczy            => 23% of total_netto
#     mieszkalny & area<=300 => 8% of total_netto
#     mieszkalny & area>300  => proportional (300/area * 8% + (area-300)/area * 23%)
#   total_brutto = total_netto + VAT
#   commission   = (commission_percent / 100) * margin_netto
# --------------------------------------------------------------------------------------
def _compute_lead_financials(lead: Dict[str, Any], settings_doc: Dict[str, Any]) -> Dict[str, float]:
    area = float(lead.get("building_area") or 0.0)
    btype = lead.get("building_type") or "mieszkalny"
    base_low = float(settings_doc.get("base_price_low") or 275.0)
    base_high = float(settings_doc.get("base_price_high") or 200.0)
    margin_per_m2 = float(settings_doc.get("margin_per_m2") or 50.0)
    commission_pct = float(settings_doc.get("commission_percent") or 50.0)

    base_rate = base_low if area <= 200 else base_high
    base_netto = round(area * base_rate, 2)

    # per-lead override margin (if present), else default
    override = lead.get("margin_override")
    if override is not None and isinstance(override, (int, float)) and override >= 0:
        margin_netto = float(override)
    else:
        margin_netto = round(area * margin_per_m2, 2)

    total_netto = round(base_netto + margin_netto, 2)

    if btype == "gospodarczy":
        vat = round(total_netto * 0.23, 2)
        vat_label = "23%"
    elif area <= 300 or area <= 0:
        vat = round(total_netto * 0.08, 2)
        vat_label = "8%"
    else:
        f8 = 300.0 / area
        f23 = (area - 300.0) / area
        vat = round(total_netto * f8 * 0.08 + total_netto * f23 * 0.23, 2)
        vat_label = "Mieszany"

    total_brutto = round(total_netto + vat, 2)
    commission = round((commission_pct / 100.0) * margin_netto, 2)

    return {
        "area": area,
        "building_type": btype,
        "base_rate_per_m2": base_rate,
        "base_netto": base_netto,
        "margin_netto": margin_netto,
        "total_netto": total_netto,
        "vat": vat,
        "vat_label": vat_label,
        "total_brutto": total_brutto,
        "commission": commission,
        "commission_percent": commission_pct,
    }


def _month_bounds(ref: Optional[datetime] = None) -> tuple:
    ref = ref or now()
    start = datetime(ref.year, ref.month, 1, tzinfo=timezone.utc)
    # first day of next month
    if ref.month == 12:
        end = datetime(ref.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(ref.year, ref.month + 1, 1, tzinfo=timezone.utc)
    return start, end


@api.get("/dashboard/finance")
async def finance_dashboard(user: Dict[str, Any] = Depends(get_current_user)):
    """Return financial aggregation for the current month.
    Scoping:
      - admin      → all signed leads in the company
      - manager    → signed leads by their team (reps where manager_id == user.id)
      - handlowiec → only their own signed leads
    """
    settings_doc = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}

    month_start, month_end = _month_bounds()

    # Build scope query
    if user["role"] == "admin":
        scope_q: Dict[str, Any] = {"status": "podpisana"}
        reps = await db.users.find({"role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
    elif user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"], "role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
        rep_ids = [r["id"] for r in reps] + [user["id"]]
        scope_q = {"status": "podpisana", "$or": [{"assigned_to": {"$in": rep_ids}}, {"owner_manager_id": user["id"]}]}
    else:  # handlowiec
        reps = [await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})]
        reps = [r for r in reps if r]
        scope_q = {"status": "podpisana", "assigned_to": user["id"]}

    signed_all = await db.leads.find(scope_q, {"_id": 0}).to_list(5000)

    def _within_month(dt: Any) -> bool:
        if isinstance(dt, datetime):
            d = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            return month_start <= d < month_end
        return False

    rep_name_by_id = {r["id"]: (r.get("name") or r.get("email") or "—") for r in reps}

    contracts_this_month = []
    contracts_total = []
    for l in signed_all:
        fin = _compute_lead_financials(l, settings_doc)
        rep_id = l.get("assigned_to")
        entry = {
            "id": l.get("id"),
            "client_name": l.get("client_name"),
            "address": l.get("address"),
            "updated_at": iso(l.get("updated_at")),
            "created_at": iso(l.get("created_at")),
            "rep_id": rep_id,
            "rep_name": rep_name_by_id.get(rep_id, "—") if rep_id else "—",
            **fin,
        }
        contracts_total.append(entry)
        if _within_month(l.get("updated_at")) or _within_month(l.get("created_at")):
            contracts_this_month.append(entry)

    def _sum(items, key):
        return round(sum(float(i.get(key) or 0) for i in items), 2)

    # Per-rep monthly breakdown (for manager & admin)
    by_rep: Dict[str, Dict[str, Any]] = {}
    for c in contracts_this_month:
        rid = c.get("rep_id") or "_unassigned"
        if rid not in by_rep:
            by_rep[rid] = {
                "rep_id": rid,
                "rep_name": c.get("rep_name") or "—",
                "signed_count": 0,
                "commission_sum": 0.0,
                "margin_sum": 0.0,
                "brutto_sum": 0.0,
            }
        by_rep[rid]["signed_count"] += 1
        by_rep[rid]["commission_sum"] = round(by_rep[rid]["commission_sum"] + (c.get("commission") or 0), 2)
        by_rep[rid]["margin_sum"] = round(by_rep[rid]["margin_sum"] + (c.get("margin_netto") or 0), 2)
        by_rep[rid]["brutto_sum"] = round(by_rep[rid]["brutto_sum"] + (c.get("total_brutto") or 0), 2)

    return {
        "period": {"month_start": iso(month_start), "month_end": iso(month_end)},
        "settings_snapshot": {
            "commission_percent": settings_doc.get("commission_percent"),
            "margin_per_m2": settings_doc.get("margin_per_m2"),
            "base_price_low": settings_doc.get("base_price_low"),
            "base_price_high": settings_doc.get("base_price_high"),
        },
        "totals_month": {
            "signed_count": len(contracts_this_month),
            "commission_sum": _sum(contracts_this_month, "commission"),
            "margin_sum": _sum(contracts_this_month, "margin_netto"),
            "netto_sum": _sum(contracts_this_month, "total_netto"),
            "brutto_sum": _sum(contracts_this_month, "total_brutto"),
            "vat_sum": _sum(contracts_this_month, "vat"),
        },
        "totals_all_time": {
            "signed_count": len(contracts_total),
            "commission_sum": _sum(contracts_total, "commission"),
            "margin_sum": _sum(contracts_total, "margin_netto"),
            "brutto_sum": _sum(contracts_total, "total_brutto"),
        },
        "by_rep": sorted(by_rep.values(), key=lambda x: x["commission_sum"], reverse=True),
        "contracts_month": sorted(contracts_this_month, key=lambda x: x.get("updated_at") or "", reverse=True),
        "contracts_all": sorted(contracts_total, key=lambda x: x.get("updated_at") or "", reverse=True),
    }



async def seed_data():
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("assigned_to")
    await db.leads.create_index("owner_manager_id")
    await db.settings.create_index("id", unique=True)
    await db.goals.create_index([("user_id", 1), ("period", 1)], unique=True)
    await db.rep_locations.create_index("user_id", unique=True)

    existing_settings = await db.settings.find_one({"id": "global"})
    if not existing_settings:
        await db.settings.insert_one(
            {
                "id": "global",
                **SettingsIn(rrso_rates=DEFAULT_RRSO, excluded_zip_codes=["77-400"]).dict(),
                "updated_at": now(),
            }
        )
    else:
        # Migration: backfill any new SettingsIn fields on existing doc
        defaults = SettingsIn(rrso_rates=DEFAULT_RRSO, excluded_zip_codes=["77-400"]).dict()
        missing = {k: v for k, v in defaults.items() if k not in existing_settings}
        if missing:
            await db.settings.update_one({"id": "global"}, {"$set": missing})
            logger.info(f"Settings migration: backfilled keys {list(missing.keys())}")

    admin_email = os.environ["ADMIN_EMAIL"].lower()
    manager_email = os.environ["MANAGER_EMAIL"].lower()
    rep_email = os.environ["REP_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    manager_pw = os.environ["MANAGER_PASSWORD"]
    rep_pw = os.environ["REP_PASSWORD"]

    async def upsert_user(email, pw, name, role, manager_id=None, avatar=None):
        existing = await db.users.find_one({"email": email})
        if not existing:
            uid = str(uuid.uuid4())
            await db.users.insert_one(
                {
                    "id": uid,
                    "email": email,
                    "password_hash": hash_password(pw),
                    "name": name,
                    "role": role,
                    "manager_id": manager_id,
                    "avatar_url": avatar,
                    "created_at": now(),
                }
            )
            return uid
        if not verify_password(pw, existing["password_hash"]):
            await db.users.update_one(
                {"email": email},
                {"$set": {"password_hash": hash_password(pw), "name": name, "role": role, "manager_id": manager_id}},
            )
        return existing["id"]

    admin_id = await upsert_user(admin_email, admin_pw, "Admin OZE", "admin")
    manager_id = await upsert_user(manager_email, manager_pw, "Marek Manager", "manager")
    rep_id = await upsert_user(
        rep_email,
        rep_pw,
        "Jan Handlowiec",
        "handlowiec",
        manager_id=manager_id,
        avatar="https://images.unsplash.com/photo-1758518727888-ffa196002e59?w=400&q=85",
    )

    demo_reps = [
        ("anna@test.com", "Anna Kowalska", "https://images.unsplash.com/photo-1655249493799-9cee4fe983bb?w=400&q=85"),
        ("piotr@test.com", "Piotr Nowak", "https://images.unsplash.com/photo-1655249481446-25d575f1c054?w=400&q=85"),
        ("ewa@test.com", "Ewa Wiśniewska", None),
    ]
    demo_rep_ids = [rep_id]
    for email, name, avatar in demo_reps:
        rid = await upsert_user(email, "test1234", name, "handlowiec", manager_id=manager_id, avatar=avatar)
        demo_rep_ids.append(rid)

    for uid, target in zip(demo_rep_ids, [10, 12, 8, 10]):
        await db.goals.update_one(
            {"user_id": uid, "period": "monthly"},
            {
                "$set": {"user_id": uid, "period": "monthly", "target": target, "updated_at": now()},
                "$setOnInsert": {"id": str(uuid.uuid4())},
            },
            upsert=True,
        )

    leads_count = await db.leads.count_documents({})
    if leads_count == 0:
        samples = [
            ("Kowalski Janusz", "podpisana", 54.372, 18.638, "Gdańsk, Grunwaldzka 1", "80-309", 180, "mieszkalny"),
            ("Nowak Jadwiga", "decyzja", 54.379, 18.600, "Gdańsk, Wrzeszcz 12", "80-264", 220, "mieszkalny"),
            ("Wiśniewski Tomasz", "umowione", 54.360, 18.650, "Gdańsk, Stare Miasto 5", "80-831", 120, "mieszkalny"),
            ("Mazur Katarzyna", "nie_zainteresowany", 54.385, 18.620, "Sopot, Bohaterów M. Cassino 30", "81-700", 95, "mieszkalny"),
            ("Kaczmarek Robert", "nowy", 54.400, 18.580, "Gdynia, 10 Lutego 24", "81-364", 350, "gospodarczy"),
            ("Lewandowski Marek", "podpisana", 54.355, 18.660, "Gdańsk, Oliwa 8", "80-288", 200, "mieszkalny"),
            ("Zieliński Paweł", "decyzja", 54.370, 18.610, "Gdańsk, Zaspa 14", "80-404", 260, "mieszkalny"),
            ("Szymańska Olga", "umowione", 54.390, 18.610, "Sopot, Haffnera 50", "81-717", 140, "mieszkalny"),
            ("Woźniak Grzegorz", "nowy", 54.410, 18.570, "Gdynia, Świętojańska 100", "81-388", 420, "gospodarczy"),
            ("Dąbrowski Artur", "nowy", 54.365, 18.645, "Gdańsk, Jasień 3", "80-174", 160, "mieszkalny"),
        ]
        for i, (name, status, lat, lng, addr, zipc, area, btype) in enumerate(samples):
            assigned = demo_rep_ids[i % len(demo_rep_ids)]
            await db.leads.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "client_name": name,
                    "status": status,
                    "latitude": lat,
                    "longitude": lng,
                    "address": addr,
                    "postal_code": zipc,
                    "building_area": float(area),
                    "building_type": btype,
                    "phone": f"+48 500 000 {100 + i:03d}",
                    "note": "Lead demo",
                    "photo_base64": None,
                    "assigned_to": assigned,
                    "owner_manager_id": manager_id,
                    "created_by": manager_id,
                    "created_at": now() - timedelta(days=i),
                    "updated_at": now() - timedelta(days=i),
                }
            )

    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_text(
        f"""# Test Credentials — OZE CRM

All test users share password: **test1234**

| Role        | Email                | Password  |
|-------------|----------------------|-----------|
| admin       | admin@test.com       | test1234  |
| manager     | manager@test.com     | test1234  |
| handlowiec  | handlowiec@test.com  | test1234  |
| handlowiec  | anna@test.com        | test1234  |
| handlowiec  | piotr@test.com       | test1234  |
| handlowiec  | ewa@test.com         | test1234  |

## Auth endpoints
- POST /api/auth/login         — body {{ email, password }} → returns {{ access_token, user }}
- GET  /api/auth/me             — Authorization: Bearer <token>
- POST /api/auth/register       — admin-only

## Notes
- Manager `manager@test.com` has 4 reps assigned (handlowiec, anna, piotr, ewa).
- 10 sample leads are seeded with GPS coordinates around Trójmiasto.
"""
    )


@api.get("/")
async def root():
    return {"message": "OZE CRM API", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await seed_data()
        logger.info("Seed completed")
    except Exception as e:
        logger.exception(f"Seed failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
