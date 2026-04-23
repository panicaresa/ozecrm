from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import sys
import uuid
import secrets as _secrets
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
import json
import asyncio

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("oze-crm")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ── Deployment env configuration (Batch A — security hardening) ──────────────
# APP_ENV controls fail-fast behaviour for weak secrets and other prod checks.
APP_ENV = os.environ.get("APP_ENV", "development").lower()
# SEED_DEMO=1 populates demo users + leads on startup. Never set to 1 on prod.
SEED_DEMO = os.environ.get("SEED_DEMO", "0") == "1"
# First-admin bootstrap email (used only when users collection is empty).
ADMIN_BOOTSTRAP_EMAIL = os.environ.get("ADMIN_BOOTSTRAP_EMAIL", "admin@grupaoze.pl").lower()

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ACCESS_TTL_HOURS = 24 * 7

# ── JWT_SECRET strength validation ───────────────────────────────────────────
# PRODUCTION: zawsze ustawić JWT_SECRET w env vars Emergent (64+ chars urlsafe).
_WEAK_JWT_VALUES = {"change-me", "changeme", "secret", "dev", "test", "default"}


def _validate_jwt_secret() -> None:
    problem: Optional[str] = None
    if not JWT_SECRET:
        problem = "JWT_SECRET is missing"
    elif JWT_SECRET.strip().lower() in _WEAK_JWT_VALUES:
        problem = "JWT_SECRET is set to a well-known weak value"
    elif len(JWT_SECRET) < 32:
        problem = f"JWT_SECRET is too short ({len(JWT_SECRET)} chars, require >=32)"
    if problem:
        if APP_ENV == "production":
            logger.error(f"FATAL: {problem}. Refusing to start in production (APP_ENV=production).")
            raise SystemExit(1)
        else:
            logger.warning(f"[dev] JWT_SECRET weak/missing: {problem}. Acceptable in APP_ENV={APP_ENV} only.")


_validate_jwt_secret()

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
        "must_change_password": bool(u.get("must_change_password", False)),
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
        if user.get("must_change_password"):
            raise HTTPException(status_code=403, detail="Password change required")
        return user

    return checker


async def require_password_changed(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Blocks sensitive writes when user still has a temporary password (must_change_password=True).

    Only GET endpoints and POST /auth/change-password remain accessible in that state.
    """
    if user.get("must_change_password"):
        raise HTTPException(status_code=403, detail="Password change required")
    return user


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


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


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
    meeting_at: Optional[str] = None  # ISO datetime for "umowione" status


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
    meeting_at: Optional[str] = None


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


# --- Contracts (Faza 1.7) ---
FINANCING_TYPES = ("credit", "cash")
WITHDRAWAL_DAYS = 14


class ContractIn(BaseModel):
    lead_id: str
    signed_at: str  # ISO date or datetime
    buildings_count: int = 1
    building_type: str  # mieszkalny | gospodarczy
    roof_area_m2: float
    gross_amount: float  # cena brutto umowy w PLN
    global_margin: float  # marża PLN — bazowa do liczenia prowizji
    financing_type: str  # credit | cash
    down_payment_amount: Optional[float] = None  # jeśli cash
    installments_count: Optional[int] = None  # jeśli cash
    total_paid_amount: Optional[float] = 0.0  # jeśli cash - początkowo ~= down_payment
    note: Optional[str] = None
    commission_percent_override: Optional[float] = None


class ContractUpdate(BaseModel):
    total_paid_amount: Optional[float] = None
    note: Optional[str] = None
    cancelled: Optional[bool] = None
    # Admin-only corrections (Faza 1.8): reduce margin by unforeseen costs
    additional_costs: Optional[float] = None
    additional_costs_note: Optional[str] = None


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


@api.post("/auth/change-password")
async def change_password(body: ChangePasswordIn, user: Dict[str, Any] = Depends(get_current_user)):
    """Force-password-change flow. Accepts current_password + new_password.

    Rules:
      - new_password length >= 12
      - new_password contains at least 1 letter AND 1 digit
      - current_password must match stored hash (bcrypt)
    On success: updates password_hash AND clears must_change_password flag.
    """
    new_pw = body.new_password or ""
    if len(new_pw) < 12:
        raise HTTPException(status_code=400, detail="Nowe hasło musi mieć co najmniej 12 znaków")
    if not any(c.isalpha() for c in new_pw) or not any(c.isdigit() for c in new_pw):
        raise HTTPException(status_code=400, detail="Nowe hasło musi zawierać min. 1 literę i 1 cyfrę")
    if not verify_password(body.current_password or "", user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Bieżące hasło jest niepoprawne")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(new_pw), "must_change_password": False}},
    )
    logger.info(f"Password changed for user {user.get('email')}")
    return {"ok": True}


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


@api.get("/leads/territory-map")
async def leads_territory_map(user: Dict[str, Any] = Depends(get_current_user)):
    """Lightweight endpoint — returns GPS coords of all leads from the last 6 months
    to help handlowiec avoid duplicate work. No client data exposed.
    Handlowiec sees ALL company leads (grey pins), manager/admin see the same.
    """
    cutoff = now() - timedelta(days=180)
    q = {
        "created_at": {"$gte": cutoff},
        "latitude": {"$ne": None},
        "longitude": {"$ne": None},
        "status": {"$nin": ["nie_zainteresowany"]},
    }
    docs = await db.leads.find(q, {"_id": 0, "id": 1, "latitude": 1, "longitude": 1, "assigned_to": 1, "status": 1}).to_list(5000)
    out = []
    for d in docs:
        is_own = (d.get("assigned_to") == user["id"])
        out.append({
            "id": d["id"],
            "lat": d["latitude"],
            "lng": d["longitude"],
            "is_own": is_own,
            "status": d.get("status"),
        })
    return out


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

    # Faza 2.1 — wymóg zdjęcia (anti-fake leads)
    if user["role"] == "handlowiec":
        if not body.photo_base64 or len(body.photo_base64) < 100:
            raise HTTPException(
                status_code=400,
                detail="Zdjęcie obiektu jest wymagane przy dodaniu leada.",
            )

    # Faza 2.1 — walidacja meeting_at dla statusu "umowione"
    if body.meeting_at:
        parsed_m = _parse_iso_dt(body.meeting_at)
        if parsed_m is None:
            raise HTTPException(status_code=400, detail="Nieprawidłowy format meeting_at.")
        cur = now()
        if parsed_m < cur - timedelta(days=1):
            raise HTTPException(status_code=400, detail="Termin spotkania nie może być wcześniejszy niż wczoraj.")
        if parsed_m > cur + timedelta(days=730):
            raise HTTPException(status_code=400, detail="Termin spotkania nie może być później niż 2 lata w przód.")

    # Faza 2.1 — Radar Dubli (anti-collision 50m)
    if body.latitude is not None and body.longitude is not None:
        # Coarse box filter first (~0.001 deg ≈ 111m), then precise haversine
        box = 0.001
        nearby_candidates = await db.leads.find(
            {
                "latitude": {"$gte": body.latitude - box, "$lte": body.latitude + box},
                "longitude": {"$gte": body.longitude - box, "$lte": body.longitude + box},
                "status": {"$nin": ["nie_zainteresowany"]},
            },
            {"_id": 0, "latitude": 1, "longitude": 1, "assigned_to": 1, "owner_manager_id": 1, "client_name": 1, "created_at": 1},
        ).to_list(100)
        six_months_ago = now() - timedelta(days=180)
        for cand in nearby_candidates:
            created = _parse_iso_dt(cand.get("created_at")) or now()
            if created < six_months_ago:
                continue
            lat2 = cand.get("latitude")
            lng2 = cand.get("longitude")
            if lat2 is None or lng2 is None:
                continue
            dist = _haversine_m(body.latitude, body.longitude, lat2, lng2)
            if dist < 50.0:
                # Resolve owner for error message
                owner_name = "innego handlowca"
                if cand.get("assigned_to"):
                    owner = await db.users.find_one(
                        {"id": cand["assigned_to"]}, {"_id": 0, "name": 1, "email": 1}
                    )
                    if owner:
                        owner_name = owner.get("name") or owner.get("email") or owner_name
                raise HTTPException(
                    status_code=409,
                    detail=f"Zbyt blisko! Pod tym adresem istnieje już lead w systemie. Należy on do {owner_name}.",
                )

    lead_id = str(uuid.uuid4())
    assigned = body.assigned_to or (user["id"] if user["role"] == "handlowiec" else None)
    owner_manager = None
    if user["role"] == "manager":
        owner_manager = user["id"]
    elif user["role"] == "handlowiec" and user.get("manager_id"):
        owner_manager = user["manager_id"]
    doc = body.dict()
    # Parse meeting_at properly if provided — store as ISO string for consistency with legacy/PATCHed leads
    if body.meeting_at:
        parsed = _parse_iso_dt(body.meeting_at)
        doc["meeting_at"] = parsed.isoformat() if parsed else None
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
    updates = body.dict(exclude_unset=True)
    if "status" in updates and updates["status"] not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    # W3: walidacja meeting_at (zakres [-1d, +2y], format)
    if "meeting_at" in updates:
        mv = updates["meeting_at"]
        if mv is not None:
            parsed = _parse_iso_dt(mv) if isinstance(mv, str) else mv
            if parsed is None:
                raise HTTPException(status_code=400, detail="Nieprawidłowy format meeting_at (wymagany ISO datetime).")
            cur = now()
            if parsed < cur - timedelta(days=1):
                raise HTTPException(status_code=400, detail="Termin spotkania nie może być wcześniejszy niż wczoraj.")
            if parsed > cur + timedelta(days=365 * 2):
                raise HTTPException(status_code=400, detail="Termin spotkania nie może być później niż 2 lata w przód.")
            # Store as ISO string for consistency
            updates["meeting_at"] = parsed.isoformat() if hasattr(parsed, "isoformat") else parsed
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
MAX_TRACK_POINTS = 500  # rolling buffer of today's polyline points
MIN_TRACK_DELTA_METERS = 10.0  # deduplicate near-identical GPS pings


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@api.put("/rep/location")
async def push_rep_location(body: RepLocationIn, user: Dict[str, Any] = Depends(require_roles("handlowiec", "manager", "admin"))):
    ts = now()
    # Fetch previous point to compute track polyline increment + session stats
    prev = await db.rep_locations.find_one({"user_id": user["id"]}, {"_id": 0})
    track: List[Dict[str, Any]] = list(prev.get("track", [])) if prev else []
    session_distance_m = float(prev.get("session_distance_m") or 0.0) if prev else 0.0
    session_started_at = prev.get("session_started_at") if prev else None
    was_active = bool(prev.get("is_active")) if prev else False
    # If session not active, start a new one
    if not was_active:
        session_distance_m = 0.0
        session_started_at = ts
        track = []  # reset track on new session
    # Reset track at midnight UTC (simple daily rollover)
    elif track:
        last_ts_raw = track[-1].get("t")
        if last_ts_raw:
            try:
                last_ts = datetime.fromisoformat(last_ts_raw.replace("Z", "+00:00"))
                if last_ts.date() != ts.date():
                    track = []
                    session_distance_m = 0.0
                    session_started_at = ts
            except Exception:
                pass
    # Compute distance from last point; append if moved > MIN_TRACK_DELTA_METERS
    add_point = True
    if track:
        last = track[-1]
        delta = _haversine_m(last["lat"], last["lng"], body.latitude, body.longitude)
        if delta < MIN_TRACK_DELTA_METERS:
            add_point = False
        else:
            session_distance_m += delta
    if add_point:
        track.append({"lat": body.latitude, "lng": body.longitude, "t": ts.isoformat()})
        if len(track) > MAX_TRACK_POINTS:
            track = track[-MAX_TRACK_POINTS:]

    doc = {
        "user_id": user["id"],
        "latitude": body.latitude,
        "longitude": body.longitude,
        "accuracy": body.accuracy,
        "battery": body.battery,
        "battery_state": body.battery_state,
        "is_active": True,
        "updated_at": ts,
        "track": track,
        "session_started_at": session_started_at,
        "session_distance_m": round(session_distance_m, 2),
    }
    await db.rep_locations.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
    # Broadcast via WS (non-blocking scope: subs already scoped)
    try:
        await broadcaster.broadcast(
            "location_update",
            {
                "rep_id": user["id"],
                "rep_name": user.get("name") or user.get("email"),
                "latitude": body.latitude,
                "longitude": body.longitude,
                "battery": body.battery,
                "is_active": True,
                "updated_at": ts.isoformat(),
                "appended": add_point,
            },
            rep_id=user["id"],
        )
    except Exception as e:
        logger.warning(f"WS broadcast failed: {e}")
    return {"ok": True, "track_len": len(track)}


@api.delete("/rep/location")
async def stop_rep_tracking(user: Dict[str, Any] = Depends(require_roles("handlowiec", "manager", "admin"))):
    # Faza 2.1 — reset session stats on stop
    await db.rep_locations.update_one(
        {"user_id": user["id"]},
        {
            "$set": {
                "is_active": False,
                "updated_at": now(),
                "session_ended_at": now(),
            }
        },
    )
    try:
        await broadcaster.broadcast(
            "location_stop",
            {"rep_id": user["id"], "rep_name": user.get("name") or user.get("email"), "is_active": False},
            rep_id=user["id"],
        )
    except Exception as e:
        logger.warning(f"WS broadcast failed: {e}")
    return {"ok": True}


@api.get("/rep/work-status")
async def my_work_status(user: Dict[str, Any] = Depends(get_current_user)):
    """Returns current work-mode state for the logged-in user (used by frontend
    to gate "Add lead" / "Offer generator" buttons for handlowiec role)."""
    loc = await db.rep_locations.find_one({"user_id": user["id"]}, {"_id": 0})
    if not loc:
        return {
            "is_working": False,
            "session_seconds": 0,
            "session_distance_m": 0.0,
            "latitude": None,
            "longitude": None,
        }
    active = bool(loc.get("is_active")) and (
        isinstance(loc.get("updated_at"), datetime)
        and (now() - (loc["updated_at"] if loc["updated_at"].tzinfo else loc["updated_at"].replace(tzinfo=timezone.utc))).total_seconds() < 30 * 60
    )
    session_seconds = 0
    session_started = loc.get("session_started_at")
    if active and isinstance(session_started, datetime):
        if session_started.tzinfo is None:
            session_started = session_started.replace(tzinfo=timezone.utc)
        session_seconds = int((now() - session_started).total_seconds())
    return {
        "is_working": active,
        "session_seconds": session_seconds,
        "session_distance_m": round(float(loc.get("session_distance_m") or 0.0), 1),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
        "updated_at": iso(loc.get("updated_at")),
    }


@api.get("/users/{user_id}/profile")
async def rep_profile(user_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Drill-down profile for a specific rep (Faza 2.1).
    Accessible by admin, manager (own team), and the rep themselves.
    """
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "handlowiec" and user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "manager" and target.get("manager_id") != user["id"] and user_id != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Leads assigned to this rep (last 90 days for drill)
    leads_raw = await db.leads.find({"assigned_to": user_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for l in leads_raw:
        l["created_at"] = iso(l.get("created_at"))
        l["updated_at"] = iso(l.get("updated_at"))
    status_breakdown: Dict[str, int] = {}
    for l in leads_raw:
        s = l.get("status") or "nowy"
        status_breakdown[s] = status_breakdown.get(s, 0) + 1
    signed_count = status_breakdown.get("podpisana", 0)
    meeting_count = status_breakdown.get("umowione", 0)

    # Session stats
    loc = await db.rep_locations.find_one({"user_id": user_id}, {"_id": 0})
    session_seconds = 0
    session_distance_m = 0.0
    is_working = False
    if loc:
        is_working = bool(loc.get("is_active"))
        if is_working and isinstance(loc.get("session_started_at"), datetime):
            s = loc["session_started_at"]
            if s.tzinfo is None:
                s = s.replace(tzinfo=timezone.utc)
            session_seconds = int((now() - s).total_seconds())
        session_distance_m = float(loc.get("session_distance_m") or 0.0)

    # Commission from contracts
    contracts = await db.contracts.find({"rep_id": user_id}, {"_id": 0}).to_list(500)
    total_payable = 0.0
    total_frozen = 0.0
    for c in contracts:
        derived = _compute_contract_status(c)
        if derived["status"] != "cancelled":
            total_payable += float(derived.get("commission_released") or 0)
            total_frozen += float(derived.get("commission_frozen") or 0)

    return {
        "user": serialize_user(target),
        "kpi": {
            "total_leads": len(leads_raw),
            "signed_count": signed_count,
            "meeting_count": meeting_count,
            "session_seconds": session_seconds,
            "session_distance_m": round(session_distance_m, 1),
            "is_working": is_working,
            "commission_payable": round(total_payable, 2),
            "commission_frozen": round(total_frozen, 2),
            "contracts_count": len([c for c in contracts if not c.get("cancelled")]),
        },
        "status_breakdown": status_breakdown,
        "leads": leads_raw[:50],
        "track": loc.get("track", []) if loc else [],
    }


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
            active = delta < 30 * 60 and bool(rl.get("is_active", True))
        # Faza 2.1 — session stats
        session_started = rl.get("session_started_at")
        session_seconds = 0
        if active and isinstance(session_started, datetime):
            if session_started.tzinfo is None:
                session_started = session_started.replace(tzinfo=timezone.utc)
            session_seconds = int((now_ts - session_started).total_seconds())
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
                "session_seconds": session_seconds,
                "session_distance_m": round(float(rl.get("session_distance_m") or 0.0), 1),
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


# --------------------------------------------------------------------------------------
# Contracts (Faza 1.7) — real signed contracts drive the Finance module
# Dynamic 14-day rule: no cron job. Status is computed on every read by comparing
# signed_at + 14 days to datetime.now(tz=utc). Raw facts are persisted
# (signed_at, financing_type, total_paid_amount, gross_amount); commission_status
# is derived.
# --------------------------------------------------------------------------------------
def _parse_iso_dt(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            s = v.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _compute_contract_status(c: Dict[str, Any], now_dt: Optional[datetime] = None) -> Dict[str, Any]:
    now_dt = now_dt or now()
    signed_at = _parse_iso_dt(c.get("signed_at")) or _parse_iso_dt(c.get("created_at")) or now_dt
    deadline = signed_at + timedelta(days=WITHDRAWAL_DAYS)

    # Faza 1.8: admin corrections (additional_costs) reduce the effective margin
    original_margin = float(c.get("global_margin") or 0.0)
    additional_costs = float(c.get("additional_costs") or 0.0)
    effective_margin = max(0.0, round(original_margin - additional_costs, 2))
    commission_pct = float(c.get("commission_percent") or 0.0)
    effective_commission_total = round((commission_pct / 100.0) * effective_margin, 2)
    # Preserve the original commission that was snapshotted at contract creation, for audit
    commission_total_original = float(c.get("commission_amount") or 0.0)
    # If admin corrections are present, "commission_total" displayed in UI reflects the effective one
    commission_total = effective_commission_total if additional_costs > 0 else commission_total_original

    gross = float(c.get("gross_amount") or 0.0)
    paid = float(c.get("total_paid_amount") or 0.0)
    financing = c.get("financing_type") or "credit"
    cancelled = bool(c.get("cancelled"))

    if cancelled:
        return {
            "status": "cancelled",
            "commission_total": commission_total,
            "commission_total_original": commission_total_original,
            "effective_margin": effective_margin,
            "additional_costs": additional_costs,
            "additional_costs_note": c.get("additional_costs_note"),
            "commission_released": 0.0,
            "commission_frozen": 0.0,
            "paid_pct": 0.0,
            "release_date": deadline.isoformat(),
            "days_until_release": 0,
            "is_cancelled": True,
        }

    days_until_release = max(0, (deadline - now_dt).days)

    if now_dt < deadline:
        return {
            "status": "frozen",
            "commission_total": commission_total,
            "commission_total_original": commission_total_original,
            "effective_margin": effective_margin,
            "additional_costs": additional_costs,
            "additional_costs_note": c.get("additional_costs_note"),
            "commission_released": 0.0,
            "commission_frozen": round(commission_total, 2),
            "paid_pct": 0.0 if gross <= 0 else round(min(1.0, paid / gross) * 100, 1),
            "release_date": deadline.isoformat(),
            "days_until_release": days_until_release,
            "is_cancelled": False,
        }

    if financing == "credit":
        return {
            "status": "payable",
            "commission_total": commission_total,
            "commission_total_original": commission_total_original,
            "effective_margin": effective_margin,
            "additional_costs": additional_costs,
            "additional_costs_note": c.get("additional_costs_note"),
            "commission_released": round(commission_total, 2),
            "commission_frozen": 0.0,
            "paid_pct": 100.0,
            "release_date": deadline.isoformat(),
            "days_until_release": 0,
            "is_cancelled": False,
        }
    if gross <= 0:
        pct = 0.0
    else:
        pct = max(0.0, min(1.0, paid / gross))
    released = round(commission_total * pct, 2)
    frozen = round(commission_total - released, 2)
    if pct >= 0.9999:
        status = "payable"
    elif pct > 0:
        status = "partial"
    else:
        status = "frozen"
    return {
        "status": status,
        "commission_total": commission_total,
        "commission_total_original": commission_total_original,
        "effective_margin": effective_margin,
        "additional_costs": additional_costs,
        "additional_costs_note": c.get("additional_costs_note"),
        "commission_released": released,
        "commission_frozen": frozen,
        "paid_pct": round(pct * 100, 1),
        "release_date": deadline.isoformat(),
        "days_until_release": 0,
        "is_cancelled": False,
    }


def _serialize_contract(c: Dict[str, Any], rep_name: Optional[str] = None) -> Dict[str, Any]:
    derived = _compute_contract_status(c)
    return {
        "id": c.get("id"),
        "lead_id": c.get("lead_id"),
        "client_name": c.get("client_name"),
        "rep_id": c.get("rep_id"),
        "rep_name": rep_name or c.get("rep_name"),
        "owner_manager_id": c.get("owner_manager_id"),
        "signed_at": iso(c.get("signed_at")),
        "created_at": iso(c.get("created_at")),
        "updated_at": iso(c.get("updated_at")),
        "buildings_count": c.get("buildings_count", 1),
        "building_type": c.get("building_type"),
        "roof_area_m2": c.get("roof_area_m2"),
        "gross_amount": c.get("gross_amount"),
        "global_margin": c.get("global_margin"),
        "financing_type": c.get("financing_type"),
        "down_payment_amount": c.get("down_payment_amount"),
        "installments_count": c.get("installments_count"),
        "total_paid_amount": c.get("total_paid_amount") or 0.0,
        "commission_percent": c.get("commission_percent"),
        "commission_amount": c.get("commission_amount"),
        "note": c.get("note"),
        "cancelled": bool(c.get("cancelled")),
        **derived,
    }


async def _contract_scope_query(user: Dict[str, Any]) -> Dict[str, Any]:
    if user["role"] == "admin":
        return {}
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = [r["id"] for r in reps] + [user["id"]]
        return {"$or": [{"rep_id": {"$in": rep_ids}}, {"owner_manager_id": user["id"]}]}
    return {"rep_id": user["id"]}


@api.post("/contracts")
async def create_contract(
    body: ContractIn,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
    _pw_check: Dict[str, Any] = Depends(require_password_changed),
):
    # ── Validation layer (Faza 1.9) ─────────────────────────────────────────────
    if body.financing_type not in FINANCING_TYPES:
        raise HTTPException(status_code=400, detail="Invalid financing_type (credit|cash)")
    if body.building_type not in ("mieszkalny", "gospodarczy"):
        raise HTTPException(status_code=400, detail="Invalid building_type")
    if body.roof_area_m2 <= 0 or body.gross_amount <= 0 or body.global_margin < 0:
        raise HTTPException(status_code=400, detail="Invalid numeric fields")

    # K5: biznesowa spójność — marża, wpłata, transze
    if body.global_margin > body.gross_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Marża ({body.global_margin:.2f} PLN) nie może być większa niż cena brutto ({body.gross_amount:.2f} PLN).",
        )
    if body.down_payment_amount is not None:
        if body.down_payment_amount < 0:
            raise HTTPException(status_code=400, detail="Wpłata własna nie może być ujemna.")
        if body.down_payment_amount > body.gross_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Wpłata własna ({body.down_payment_amount:.2f} PLN) nie może być większa niż cena brutto ({body.gross_amount:.2f} PLN).",
            )
    if body.total_paid_amount is not None and body.total_paid_amount < 0:
        raise HTTPException(status_code=400, detail="Kwota opłacona nie może być ujemna.")
    if body.installments_count is not None and body.installments_count < 1:
        raise HTTPException(status_code=400, detail="Liczba transz musi być >= 1.")

    # K1: walidacja signed_at (przeciw oszustwom prowizyjnym)
    signed_at = _parse_iso_dt(body.signed_at) or now()
    cur = now()
    if signed_at > cur + timedelta(days=1):
        raise HTTPException(status_code=400, detail="Data podpisania nie może być z przyszłości.")
    # Handlowiec: tylko dzień wczorajszy/dzisiejszy (tolerancja 2 dni wstecz na timezone)
    max_backdate_days = 90 if user["role"] == "admin" else 2
    min_signed = cur - timedelta(days=max_backdate_days)
    if signed_at < min_signed:
        if user["role"] == "admin":
            raise HTTPException(
                status_code=400,
                detail=f"Admin może cofnąć datę podpisania maksymalnie o 90 dni wstecz (minimum: {min_signed.date().isoformat()}).",
            )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Data podpisania może być tylko wczorajsza lub dzisiejsza. "
                f"W przypadku korekty historycznej skontaktuj się z Adminem."
            ),
        )

    # W2: commission_percent_override tylko dla admin/manager
    if body.commission_percent_override is not None and user["role"] == "handlowiec":
        raise HTTPException(
            status_code=403,
            detail="Handlowiec nie może nadpisywać % prowizji. Skontaktuj się z Adminem.",
        )
    if body.commission_percent_override is not None:
        if body.commission_percent_override < 0 or body.commission_percent_override > 100:
            raise HTTPException(status_code=400, detail="commission_percent_override musi być w zakresie 0-100.")

    lead = await _ensure_lead_access(body.lead_id, user)

    # K6: idempotency — protect against duplicate POST from network retries on 2G
    idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Idempotency-Key")
    if idempotency_key:
        existing = await db.contracts.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if existing:
            # Return existing contract (idempotent replay) instead of creating duplicate
            return _serialize_contract(existing)

    settings_doc = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    commission_pct = (
        float(body.commission_percent_override)
        if body.commission_percent_override is not None
        else float(settings_doc.get("commission_percent") or 50.0)
    )
    commission_amount = round((commission_pct / 100.0) * float(body.global_margin), 2)
    total_paid = float(body.total_paid_amount or 0.0)
    if body.financing_type == "cash" and body.down_payment_amount is not None and total_paid <= 0:
        total_paid = float(body.down_payment_amount)
    contract_id = str(uuid.uuid4())
    rep_id = lead.get("assigned_to") or (user["id"] if user["role"] == "handlowiec" else None)
    owner_manager_id = lead.get("owner_manager_id")
    doc = {
        "id": contract_id,
        "lead_id": body.lead_id,
        "client_name": lead.get("client_name"),
        "rep_id": rep_id,
        "owner_manager_id": owner_manager_id,
        "signed_at": signed_at,
        "buildings_count": int(body.buildings_count or 1),
        "building_type": body.building_type,
        "roof_area_m2": float(body.roof_area_m2),
        "gross_amount": float(body.gross_amount),
        "global_margin": float(body.global_margin),
        "financing_type": body.financing_type,
        "down_payment_amount": float(body.down_payment_amount) if body.down_payment_amount is not None else None,
        "installments_count": int(body.installments_count) if body.installments_count is not None else None,
        "total_paid_amount": round(total_paid, 2),
        "commission_percent": commission_pct,
        "commission_amount": commission_amount,
        "note": body.note,
        "cancelled": False,
        "idempotency_key": idempotency_key,
        "created_by": user["id"],
        "created_at": now(),
        "updated_at": now(),
    }
    try:
        await db.contracts.insert_one(doc)
    except Exception as e:
        # Race condition — another concurrent POST won the insert; try to fetch by key
        if idempotency_key:
            existing = await db.contracts.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
            if existing:
                return _serialize_contract(existing)
        raise HTTPException(status_code=500, detail=f"Insert failed: {e}")
    await db.leads.update_one({"id": body.lead_id}, {"$set": {"status": "podpisana", "updated_at": now()}})
    return _serialize_contract(doc)


@api.get("/contracts")
async def list_contracts(user: Dict[str, Any] = Depends(get_current_user)):
    q = await _contract_scope_query(user)
    docs = await db.contracts.find(q, {"_id": 0}).sort("signed_at", -1).to_list(1000)
    users_map = {u["id"]: u for u in await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)}
    out = []
    for c in docs:
        u = users_map.get(c.get("rep_id"))
        name = (u.get("name") or u.get("email")) if u else "—"
        out.append(_serialize_contract(c, rep_name=name))
    return out


@api.patch("/contracts/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, user: Dict[str, Any] = Depends(require_roles("admin", "manager"))):
    c = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = {r["id"] for r in reps} | {user["id"]}
        if c.get("owner_manager_id") != user["id"] and c.get("rep_id") not in rep_ids:
            raise HTTPException(status_code=403, detail="Forbidden")
    updates: Dict[str, Any] = {}
    audit_entries: List[Dict[str, Any]] = []

    def _track(field: str, new_val: Any, extra: Optional[Dict[str, Any]] = None):
        old_val = c.get(field)
        audit_entries.append(
            {
                "id": str(uuid.uuid4()),
                "contract_id": contract_id,
                "field": field,
                "old_value": old_val,
                "new_value": new_val,
                "changed_by": user["id"],
                "changed_by_name": user.get("name") or user.get("email"),
                "changed_by_role": user["role"],
                "changed_at": now(),
                **(extra or {}),
            }
        )

    if body.total_paid_amount is not None:
        if body.total_paid_amount < 0:
            raise HTTPException(status_code=400, detail="total_paid_amount must be >= 0")
        gross = float(c.get("gross_amount") or 0)
        # K5: wpłata > brutto blokada (z tolerancją 5% dla odsetek/pomyłek)
        if gross > 0 and float(body.total_paid_amount) > gross * 1.05:
            raise HTTPException(
                status_code=400,
                detail=f"Kwota wpłacona ({body.total_paid_amount:.2f} PLN) nie może przekroczyć ceny brutto o >5% ({gross * 1.05:.2f} PLN).",
            )
        new_val = round(float(body.total_paid_amount), 2)
        if new_val != (c.get("total_paid_amount") or 0.0):
            _track("total_paid_amount", new_val)
        updates["total_paid_amount"] = new_val
    if body.note is not None:
        if (body.note or "") != (c.get("note") or ""):
            _track("note", body.note)
        updates["note"] = body.note
    if body.cancelled is not None:
        if bool(body.cancelled) != bool(c.get("cancelled")):
            _track("cancelled", bool(body.cancelled))
        updates["cancelled"] = bool(body.cancelled)
    # Faza 1.8: admin-only corrections
    if body.additional_costs is not None or body.additional_costs_note is not None:
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only admin can set additional_costs corrections")
        if body.additional_costs is not None:
            if body.additional_costs < 0:
                raise HTTPException(status_code=400, detail="additional_costs must be >= 0")
            new_val = round(float(body.additional_costs), 2)
            if new_val != float(c.get("additional_costs") or 0):
                _track("additional_costs", new_val, extra={"reason_note": body.additional_costs_note})
            updates["additional_costs"] = new_val
        if body.additional_costs_note is not None:
            if (body.additional_costs_note or "") != (c.get("additional_costs_note") or ""):
                _track("additional_costs_note", body.additional_costs_note)
            updates["additional_costs_note"] = body.additional_costs_note
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = now()
    await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    # Persist audit log entries
    if audit_entries:
        await db.contract_audit_log.insert_many(audit_entries)
    updated = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    u = await db.users.find_one({"id": updated.get("rep_id")}, {"_id": 0, "password_hash": 0}) if updated.get("rep_id") else None
    name = (u.get("name") or u.get("email")) if u else None
    return _serialize_contract(updated, rep_name=name)


@api.get("/contracts/{contract_id}/audit-log")
async def get_contract_audit_log(contract_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Return full audit history. Accessible to admin/manager (team scope) + handlowiec (own)."""
    c = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    # Scope check
    if user["role"] == "handlowiec" and c.get("rep_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = {r["id"] for r in reps} | {user["id"]}
        if c.get("owner_manager_id") != user["id"] and c.get("rep_id") not in rep_ids:
            raise HTTPException(status_code=403, detail="Forbidden")
    entries = await db.contract_audit_log.find({"contract_id": contract_id}, {"_id": 0}).sort("changed_at", -1).to_list(500)
    for e in entries:
        if "changed_at" in e:
            e["changed_at"] = iso(e["changed_at"])
    return entries


@api.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")
    # scope
    if user["role"] == "handlowiec" and c.get("rep_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = {r["id"] for r in reps} | {user["id"]}
        if c.get("owner_manager_id") != user["id"] and c.get("rep_id") not in rep_ids:
            raise HTTPException(status_code=403, detail="Forbidden")
    u = await db.users.find_one({"id": c.get("rep_id")}, {"_id": 0, "password_hash": 0}) if c.get("rep_id") else None
    name = (u.get("name") or u.get("email")) if u else None
    return _serialize_contract(c, rep_name=name)


@api.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, admin: Dict[str, Any] = Depends(require_roles("admin"))):
    res = await db.contracts.delete_one({"id": contract_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"ok": True}


# --- Calendar ---
@api.get("/calendar/meetings")
async def list_meetings(user: Dict[str, Any] = Depends(get_current_user)):
    if user["role"] == "admin":
        q: Dict[str, Any] = {"status": "umowione", "meeting_at": {"$ne": None}}
    elif user["role"] == "manager":
        reps = await db.users.find({"manager_id": user["id"]}, {"id": 1, "_id": 0}).to_list(500)
        rep_ids = [r["id"] for r in reps] + [user["id"]]
        q = {"status": "umowione", "meeting_at": {"$ne": None}, "$or": [{"assigned_to": {"$in": rep_ids}}, {"owner_manager_id": user["id"]}]}
    else:
        q = {"status": "umowione", "meeting_at": {"$ne": None}, "assigned_to": user["id"]}
    leads = await db.leads.find(q, {"_id": 0}).to_list(1000)
    users_map = {u["id"]: u for u in await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)}
    out = []
    for l in leads:
        rep = users_map.get(l.get("assigned_to"))
        # Normalize meeting_at to ISO string (legacy rows may have datetime)
        m_at = l.get("meeting_at")
        if isinstance(m_at, datetime):
            m_at = iso(m_at)
        out.append({
            "lead_id": l.get("id"),
            "client_name": l.get("client_name"),
            "phone": l.get("phone"),
            "address": l.get("address"),
            "meeting_at": m_at,
            "latitude": l.get("latitude"),
            "longitude": l.get("longitude"),
            "rep_id": l.get("assigned_to"),
            "rep_name": (rep.get("name") or rep.get("email")) if rep else "—",
            "note": l.get("note"),
        })
    out.sort(key=lambda x: (x.get("meeting_at") or ""))
    return out


# --- Finance v2: contracts-based ---
@api.get("/dashboard/finance-v2")
async def finance_dashboard_v2(user: Dict[str, Any] = Depends(get_current_user)):
    q = await _contract_scope_query(user)
    settings_doc = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    contracts_raw = await db.contracts.find(q, {"_id": 0}).to_list(5000)
    users_map = {u["id"]: u for u in await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)}
    month_start, month_end = _month_bounds()
    contracts_all = []
    contracts_month = []
    for c in contracts_raw:
        rep = users_map.get(c.get("rep_id"))
        name = (rep.get("name") or rep.get("email")) if rep else "—"
        entry = _serialize_contract(c, rep_name=name)
        contracts_all.append(entry)
        signed = _parse_iso_dt(c.get("signed_at"))
        if signed and month_start <= signed < month_end:
            contracts_month.append(entry)

    def _sum(items, key):
        return round(sum(float(i.get(key) or 0) for i in items), 2)

    frozen_all = [c for c in contracts_all if c["status"] == "frozen"]
    partial_all = [c for c in contracts_all if c["status"] == "partial"]
    payable_all = [c for c in contracts_all if c["status"] == "payable"]
    cancelled_all = [c for c in contracts_all if c["status"] == "cancelled"]

    # Y1: aggregations MUST exclude cancelled (accounting correctness)
    active_all = [c for c in contracts_all if c["status"] != "cancelled"]
    active_month = [c for c in contracts_month if c["status"] != "cancelled"]

    by_rep: Dict[str, Dict[str, Any]] = {}
    for c in active_month:
        rid = c.get("rep_id") or "_unassigned"
        if rid not in by_rep:
            by_rep[rid] = {
                "rep_id": rid,
                "rep_name": c.get("rep_name") or "—",
                "signed_count": 0,
                "commission_payable_sum": 0.0,
                "commission_frozen_sum": 0.0,
                "margin_sum": 0.0,
                "brutto_sum": 0.0,
            }
        by_rep[rid]["signed_count"] += 1
        by_rep[rid]["commission_payable_sum"] = round(by_rep[rid]["commission_payable_sum"] + (c.get("commission_released") or 0), 2)
        by_rep[rid]["commission_frozen_sum"] = round(by_rep[rid]["commission_frozen_sum"] + (c.get("commission_frozen") or 0), 2)
        by_rep[rid]["margin_sum"] = round(by_rep[rid]["margin_sum"] + (c.get("global_margin") or 0), 2)
        by_rep[rid]["brutto_sum"] = round(by_rep[rid]["brutto_sum"] + (c.get("gross_amount") or 0), 2)

    return {
        "period": {"month_start": iso(month_start), "month_end": iso(month_end)},
        "settings_snapshot": {
            "commission_percent": settings_doc.get("commission_percent"),
            "withdrawal_days": WITHDRAWAL_DAYS,
        },
        "totals_month": {
            "signed_count": len(active_month),
            "commission_payable_sum": _sum(active_month, "commission_released"),
            "commission_frozen_sum": _sum(active_month, "commission_frozen"),
            "commission_total_sum": _sum(active_month, "commission_total"),
            "margin_sum": _sum(active_month, "global_margin"),
            "brutto_sum": _sum(active_month, "gross_amount"),
            "cancelled_count": len([c for c in contracts_month if c["status"] == "cancelled"]),
            "cancelled_gross_sum": _sum([c for c in contracts_month if c["status"] == "cancelled"], "gross_amount"),
        },
        "totals_all_time": {
            "signed_count": len(active_all),
            "commission_payable_sum": _sum(active_all, "commission_released"),
            "commission_frozen_sum": _sum(active_all, "commission_frozen"),
            "commission_total_sum": _sum(active_all, "commission_total"),
            "margin_sum": _sum(active_all, "global_margin"),
            "brutto_sum": _sum(active_all, "gross_amount"),
            "cancelled_count": len(cancelled_all),
        },
        "by_rep": sorted(by_rep.values(), key=lambda x: x["commission_payable_sum"], reverse=True),
        "frozen_contracts": sorted(frozen_all, key=lambda x: x.get("release_date") or ""),
        "partial_contracts": sorted(partial_all, key=lambda x: x.get("signed_at") or "", reverse=True),
        "payable_contracts": sorted(payable_all, key=lambda x: x.get("signed_at") or "", reverse=True),
        "cancelled_contracts": sorted(cancelled_all, key=lambda x: x.get("updated_at") or x.get("signed_at") or "", reverse=True),
        "contracts_month": sorted(contracts_month, key=lambda x: x.get("signed_at") or "", reverse=True),
        "contracts_all": sorted(contracts_all, key=lambda x: x.get("signed_at") or "", reverse=True),
    }




async def ensure_indexes_and_migrations():
    """Idempotent indexes + schema migrations. Always runs at startup (dev & prod)."""
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("assigned_to")
    await db.leads.create_index("owner_manager_id")
    await db.settings.create_index("id", unique=True)
    await db.goals.create_index([("user_id", 1), ("period", 1)], unique=True)
    await db.rep_locations.create_index("user_id", unique=True)
    await db.contracts.create_index("rep_id")
    await db.contracts.create_index("owner_manager_id")
    await db.contracts.create_index("signed_at")
    await db.contracts.create_index("idempotency_key", sparse=True)
    await db.contract_audit_log.create_index("contract_id")
    await db.contract_audit_log.create_index("changed_at")

    # Migration: ensure must_change_password flag exists on every user (default False)
    try:
        await db.users.update_many(
            {"must_change_password": {"$exists": False}},
            {"$set": {"must_change_password": False}},
        )
    except Exception as e:
        logger.warning(f"must_change_password migration skipped: {e}")

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
        # Backfill any new SettingsIn fields on existing doc
        defaults = SettingsIn(rrso_rates=DEFAULT_RRSO, excluded_zip_codes=["77-400"]).dict()
        missing = {k: v for k, v in defaults.items() if k not in existing_settings}
        if missing:
            await db.settings.update_one({"id": "global"}, {"$set": missing})
            logger.info(f"Settings migration: backfilled keys {list(missing.keys())}")


async def seed_prod_admin_if_empty():
    """If users collection is empty, create ONE bootstrap admin with a random
    temporary password and must_change_password=True. Prints the password once
    to stdout so the deployer can read it from container logs. Never re-creates
    if at least one user already exists."""
    count = await db.users.count_documents({})
    if count > 0:
        return
    temp_password = _secrets.token_urlsafe(16)  # ~22 chars url-safe
    admin_doc = {
        "id": str(uuid.uuid4()),
        "email": ADMIN_BOOTSTRAP_EMAIL,
        "password_hash": hash_password(temp_password),
        "name": "Administrator",
        "role": "admin",
        "manager_id": None,
        "avatar_url": None,
        "must_change_password": True,
        "created_at": now(),
    }
    await db.users.insert_one(admin_doc)
    line = "=" * 60
    # stdout only — NOT written to any file
    print(line, flush=True)
    print("BOOTSTRAP ADMIN CREATED — SAVE THIS PASSWORD:", flush=True)
    print(f"  Email: {ADMIN_BOOTSTRAP_EMAIL}", flush=True)
    print(f"  Password: {temp_password}", flush=True)
    print("  ⚠️ You MUST change this password on first login.", flush=True)
    print("  ⚠️ This message will NOT be shown again.", flush=True)
    print(line, flush=True)


async def seed_data():
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("assigned_to")
    await db.leads.create_index("owner_manager_id")
    await db.settings.create_index("id", unique=True)
    await db.goals.create_index([("user_id", 1), ("period", 1)], unique=True)
    await db.rep_locations.create_index("user_id", unique=True)
    await db.contracts.create_index("rep_id")
    await db.contracts.create_index("owner_manager_id")
    await db.contracts.create_index("signed_at")
    await db.contracts.create_index("idempotency_key", sparse=True)
    await db.contract_audit_log.create_index("contract_id")
    await db.contract_audit_log.create_index("changed_at")

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


# ── CORS whitelist (Batch A — security hardening) ────────────────────────────
# PRODUCTION: zawsze ustawić CORS_ALLOWED_ORIGINS w env vars Emergent (CSV).
CORS_ALLOWED_ORIGINS_RAW = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
if CORS_ALLOWED_ORIGINS_RAW:
    _cors_origins = [o.strip() for o in CORS_ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
    _cors_allow_credentials = True
    logger.info(f"CORS whitelist enabled ({len(_cors_origins)} origin(s)): {_cors_origins}")
else:
    _cors_origins = ["*"]
    _cors_allow_credentials = False  # browsers reject credentials + wildcard combo
    logger.warning(
        "CORS wildcard enabled (no CORS_ALLOWED_ORIGINS env var). "
        "PRODUCTION: set CORS_ALLOWED_ORIGINS in env vars."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await ensure_indexes_and_migrations()
        await seed_prod_admin_if_empty()
        if SEED_DEMO:
            logger.info("Demo seed: ENABLED (SEED_DEMO=1)")
            await seed_data()
        else:
            logger.info("Demo seed: DISABLED (SEED_DEMO != 1) — only indexes + migrations ran")
        logger.info("Startup completed")
    except SystemExit:
        raise
    except Exception as e:
        logger.exception(f"Startup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ──────────────────────────────────────────────────────────────────────────────
# Faza 2.0 — WebSocket rep-locations broadcaster + polyline tracks
# ──────────────────────────────────────────────────────────────────────────────
class LocationBroadcaster:
    """In-memory pub/sub for live rep locations.
    Reps (handlowiec) push location via REST PUT /rep/location which fans-out to
    all connected admin/manager WebSockets whose scope covers that rep.
    """

    def __init__(self) -> None:
        self._subs: Dict[str, Dict[str, Any]] = {}  # ws_id → {ws, user}
        self._lock = asyncio.Lock()

    async def subscribe(self, ws_id: str, ws: WebSocket, user: Dict[str, Any]) -> None:
        async with self._lock:
            self._subs[ws_id] = {"ws": ws, "user": user}
        logger.info(f"WS subscribed: {ws_id} role={user['role']} ({len(self._subs)} total)")

    async def unsubscribe(self, ws_id: str) -> None:
        async with self._lock:
            self._subs.pop(ws_id, None)
        logger.info(f"WS unsubscribed: {ws_id} ({len(self._subs)} remain)")

    async def broadcast(self, event_type: str, payload: Dict[str, Any], rep_id: Optional[str] = None) -> None:
        """Send event to all subscribers whose scope includes rep_id (or admin)."""
        if not self._subs:
            return
        # Pre-compute which managers can see which reps (one DB hit)
        manager_team: Dict[str, set] = {}
        for sub in list(self._subs.values()):
            u = sub["user"]
            if u["role"] == "manager" and u["id"] not in manager_team:
                reps = await db.users.find({"manager_id": u["id"]}, {"id": 1, "_id": 0}).to_list(500)
                manager_team[u["id"]] = {r["id"] for r in reps} | {u["id"]}
        msg = json.dumps({"type": event_type, **payload})
        dead_ids: List[str] = []
        for ws_id, sub in list(self._subs.items()):
            u = sub["user"]
            # Scope filtering
            if rep_id is not None:
                if u["role"] == "handlowiec" and u["id"] != rep_id:
                    continue
                if u["role"] == "manager" and rep_id not in manager_team.get(u["id"], set()):
                    continue
            try:
                await sub["ws"].send_text(msg)
            except Exception:
                dead_ids.append(ws_id)
        for dead in dead_ids:
            await self.unsubscribe(dead)


broadcaster = LocationBroadcaster()


async def _authenticate_ws(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
        user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        return user
    except Exception:
        return None


@app.websocket("/ws/rep-locations")
async def ws_rep_locations(ws: WebSocket):
    """WS endpoint for live rep locations. Clients must send {"token": <jwt>} as
    the first frame within 5s after connect to authenticate.
    """
    await ws.accept()
    ws_id = str(uuid.uuid4())
    user: Optional[Dict[str, Any]] = None
    try:
        # Await first frame with token
        try:
            auth_raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
            auth_msg = json.loads(auth_raw)
            token = auth_msg.get("token")
        except Exception:
            await ws.close(code=4001)
            return
        user = await _authenticate_ws(token or "")
        if not user:
            await ws.send_text(json.dumps({"type": "auth_error", "detail": "Invalid token"}))
            await ws.close(code=4001)
            return
        await ws.send_text(json.dumps({"type": "auth_ok", "user_id": user["id"], "role": user["role"]}))
        await broadcaster.subscribe(ws_id, ws, user)

        # Seed current snapshot for admin/manager
        if user["role"] in ("admin", "manager"):
            if user["role"] == "admin":
                reps = await db.users.find({"role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
            else:
                reps = await db.users.find({"manager_id": user["id"], "role": "handlowiec"}, {"_id": 0, "password_hash": 0}).to_list(500)
            rep_ids = [r["id"] for r in reps]
            locs = await db.rep_locations.find({"user_id": {"$in": rep_ids}}, {"_id": 0}).to_list(500)
            await ws.send_text(json.dumps({
                "type": "snapshot",
                "locations": [
                    {
                        "rep_id": l["user_id"],
                        "latitude": l.get("latitude"),
                        "longitude": l.get("longitude"),
                        "battery": l.get("battery"),
                        "is_active": l.get("is_active"),
                        "updated_at": iso(l.get("updated_at")),
                        "track": l.get("track", []),  # polyline recent points
                    }
                    for l in locs
                ],
            }))

        # Keepalive / handle pings
        while True:
            try:
                data = await ws.receive_text()
                # Optional ping/pong
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await ws.send_text(json.dumps({"type": "pong"}))
                except Exception:
                    pass
            except WebSocketDisconnect:
                break
    finally:
        await broadcaster.unsubscribe(ws_id)


@api.get("/tracking/track/{rep_id}")
async def get_rep_track(rep_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Return polyline points (today's track) of a given rep. Role-scoped."""
    if user["role"] == "handlowiec" and user["id"] != rep_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "manager":
        target = await db.users.find_one({"id": rep_id}, {"manager_id": 1, "_id": 0})
        if not target or (target.get("manager_id") != user["id"] and rep_id != user["id"]):
            raise HTTPException(status_code=403, detail="Forbidden")
    loc = await db.rep_locations.find_one({"user_id": rep_id}, {"_id": 0})
    if not loc:
        return {"rep_id": rep_id, "track": [], "updated_at": None}
    return {
        "rep_id": rep_id,
        "track": loc.get("track", []),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
        "is_active": loc.get("is_active"),
        "updated_at": iso(loc.get("updated_at")),
    }



# Mount the API router LAST so all @api.* decorators above are registered.
app.include_router(api)
