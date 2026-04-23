"""
Phase 2.1 backend tests — Territory control + D2D rigor + rep profile.
Uses the public BACKEND_URL from frontend/.env (EXPO_PUBLIC_BACKEND_URL) and /api prefix.
"""

import os
import sys
import time
import requests
from datetime import datetime, timedelta, timezone

# Resolve backend URL from frontend/.env
BACKEND_URL = None
try:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BACKEND_URL = line.split("=", 1)[1].strip().strip('"')
                break
except Exception:
    pass
if not BACKEND_URL:
    BACKEND_URL = "http://localhost:8001"
API = BACKEND_URL.rstrip("/") + "/api"

PASSWORD = "test1234"
USERS = {
    "admin": "admin@test.com",
    "manager": "manager@test.com",
    "handlowiec": "handlowiec@test.com",
    "anna": "anna@test.com",
}

PASS = 0
FAIL = 0
FAILS = []


def rec(cond, label, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        FAILS.append(f"{label} :: {extra}")
        print(f"  FAIL  {label} :: {extra}")


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


print(f"BACKEND: {API}")
print("=" * 70)
print("LOGIN all roles")
print("=" * 70)
admin_tok, admin_u = login(USERS["admin"])
mgr_tok, mgr_u = login(USERS["manager"])
rep_tok, rep_u = login(USERS["handlowiec"])
anna_tok, anna_u = login(USERS["anna"])
rec(admin_u["role"] == "admin", "admin login role=admin")
rec(mgr_u["role"] == "manager", "manager login role=manager")
rec(rep_u["role"] == "handlowiec", "handlowiec login role=handlowiec")
rec(anna_u["role"] == "handlowiec", "anna login role=handlowiec")

rep_id = rep_u["id"]
anna_id = anna_u["id"]
admin_id = admin_u["id"]
mgr_id = mgr_u["id"]

BIG_PHOTO = "a" * 200

created_leads = []  # ids to cleanup

# Helpers — use unique coordinates far from existing seeded leads to avoid collision noise
# The seed uses Trójmiasto (~54.35-54.4 lat, 18.6-18.7 lng) so we'll use 54.97xxx / 19.10xxx
def unique_lat():
    # Use 54.97xxx range (far from Gdansk seeds) + session-unique offset
    return 54.95 + (time.time() % 600) / 10000.0


# Reserve one base location with small random offset to avoid interference with parallel runs
BASE_LAT = 54.9700 + (int(time.time()) % 500) / 100000.0
BASE_LNG = 19.1050 + (int(time.time()) % 500) / 100000.0
print(f"Using BASE_LAT={BASE_LAT}, BASE_LNG={BASE_LNG}")

print()
print("=" * 70)
print("1) Required photo_base64 on POST /leads (handlowiec only)")
print("=" * 70)


def post_lead(tok, body, expect):
    r = requests.post(f"{API}/leads", headers=H(tok), json=body, timeout=20)
    ok = r.status_code == expect
    return ok, r


# Use coords far from any collision zone (different lat each call to avoid 50m trigger)
body_no_photo = {"client_name": "Testowy Klient 1", "status": "nowy", "latitude": BASE_LAT + 0.05, "longitude": BASE_LNG + 0.05}
ok, r = post_lead(rep_tok, body_no_photo, 400)
rec(ok, "handlowiec POST /leads without photo → 400", f"got {r.status_code} {r.text[:150]}")
rec("Zdjęcie" in r.text, "Polish msg contains 'Zdjęcie'", r.text[:100])

body_empty_photo = {"client_name": "Testowy 2", "status": "nowy", "photo_base64": "", "latitude": BASE_LAT + 0.051, "longitude": BASE_LNG + 0.05}
ok, r = post_lead(rep_tok, body_empty_photo, 400)
rec(ok, "handlowiec photo='' → 400", f"got {r.status_code}")

body_short_photo = {"client_name": "Testowy 3", "status": "nowy", "photo_base64": "x", "latitude": BASE_LAT + 0.052, "longitude": BASE_LNG + 0.05}
ok, r = post_lead(rep_tok, body_short_photo, 400)
rec(ok, "handlowiec photo too short (<100) → 400", f"got {r.status_code}")

body_ok_photo = {"client_name": "Anna Nowakowska", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": BASE_LAT + 0.053, "longitude": BASE_LNG + 0.05}
ok, r = post_lead(rep_tok, body_ok_photo, 200)
rec(ok, "handlowiec valid 200-char photo → 200", f"got {r.status_code} {r.text[:120]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

# Manager without photo
body_mgr = {"client_name": "Piotr Mg", "status": "nowy", "latitude": BASE_LAT + 0.06, "longitude": BASE_LNG + 0.06}
ok, r = post_lead(mgr_tok, body_mgr, 200)
rec(ok, "manager POST /leads w/o photo → 200", f"got {r.status_code} {r.text[:120]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

# Admin without photo
body_adm = {"client_name": "Adam Ad", "status": "nowy", "latitude": BASE_LAT + 0.07, "longitude": BASE_LNG + 0.07}
ok, r = post_lead(admin_tok, body_adm, 200)
rec(ok, "admin POST /leads w/o photo → 200", f"got {r.status_code} {r.text[:120]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

print()
print("=" * 70)
print("2) Anti-collision 50m radius on POST /leads")
print("=" * 70)

# Use fresh location zone (far north)
AC_LAT = 54.37000
AC_LNG = 18.63000
# Jitter the base to avoid pre-existing leads at these exact coords (the review uses 54.37 / 18.63 which IS within seeded Trójmiasto lat)
AC_LAT = 55.1234 + (int(time.time()) % 900) / 100000.0
AC_LNG = 19.5678 + (int(time.time()) % 900) / 100000.0
print(f"Anti-collision base: {AC_LAT},{AC_LNG}")

# Lead A at base
body_A = {"client_name": "Jan Kowalski AC", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT, "longitude": AC_LNG}
ok, r = post_lead(rep_tok, body_A, 200)
rec(ok, "Lead A at base → 200", f"got {r.status_code} {r.text[:120]}")
lead_A_id = None
if r.status_code == 200:
    lead_A_id = r.json()["id"]
    created_leads.append((lead_A_id, admin_tok))

# ~3m away
body_dup = {"client_name": "Marek Zbyt Blisko", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT + 0.00002, "longitude": AC_LNG + 0.00002}
ok, r = post_lead(rep_tok, body_dup, 409)
rec(ok, "Lead ~3m apart → 409", f"got {r.status_code} {r.text[:150]}")
rec("Zbyt blisko" in r.text, "Polish 'Zbyt blisko' message", r.text[:100])

# ~500m away (delta ~0.005 lat = ~555m)
body_far = {"client_name": "Daleki Lead", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT + 0.005, "longitude": AC_LNG + 0.010}
ok, r = post_lead(rep_tok, body_far, 200)
rec(ok, "Lead ~500m apart → 200", f"got {r.status_code} {r.text[:120]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

# ~40m away (delta 0.00035 lat ~= 39m)
body_40m = {"client_name": "Close Lead 40m", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT + 0.00035, "longitude": AC_LNG + 0.00015}
ok, r = post_lead(rep_tok, body_40m, 409)
rec(ok, "Lead ~40m apart → 409", f"got {r.status_code} {r.text[:150]}")

# ~60m away (delta 0.0006 lat ~= 67m)
body_60m = {"client_name": "Outside Radius", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT + 0.0006, "longitude": AC_LNG + 0.00015}
ok, r = post_lead(rep_tok, body_60m, 200)
rec(ok, "Lead ~60m apart → 200", f"got {r.status_code} {r.text[:120]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

# If first lead becomes nie_zainteresowany, the ~3m should succeed
if lead_A_id:
    r = requests.patch(f"{API}/leads/{lead_A_id}", headers=H(admin_tok), json={"status": "nie_zainteresowany"}, timeout=20)
    rec(r.status_code == 200, "PATCH lead A to nie_zainteresowany → 200", f"got {r.status_code} {r.text[:120]}")
    # Now try a fresh lead at ~3m (must not collide with A since A is 'nie_zainteresowany' and ignored)
    # But it may collide with the 40m/60m ones. Use A-exact + tiny offset.
    body_retry = {"client_name": "Ponowny Lead", "status": "nowy", "photo_base64": BIG_PHOTO, "latitude": AC_LAT + 0.00003, "longitude": AC_LNG + 0.00003}
    ok, r = post_lead(rep_tok, body_retry, 200)
    rec(ok, "After A set 'nie_zainteresowany', retry at ~3m from A → 200", f"got {r.status_code} {r.text[:150]}")
    if r.status_code == 200:
        created_leads.append((r.json()["id"], admin_tok))

print()
print("=" * 70)
print("3) meeting_at validation at lead creation")
print("=" * 70)

now_utc = datetime.now(timezone.utc)
m_1y = (now_utc + timedelta(days=365)).isoformat().replace("+00:00", "Z")
m_3y = (now_utc + timedelta(days=1095)).isoformat().replace("+00:00", "Z")
m_5d_ago = (now_utc - timedelta(days=5)).isoformat().replace("+00:00", "Z")

# Use a new unique location to avoid collisions
MT_LAT = 56.1234 + (int(time.time()) % 500) / 100000.0
MT_LNG = 20.5678 + (int(time.time()) % 500) / 100000.0

body_m1 = {"client_name": "Spotkanie 1 rok", "status": "umowione", "photo_base64": BIG_PHOTO,
           "latitude": MT_LAT, "longitude": MT_LNG, "meeting_at": m_1y}
ok, r = post_lead(rep_tok, body_m1, 200)
rec(ok, "meeting_at +1y → 200", f"got {r.status_code} {r.text[:150]}")
if r.status_code == 200:
    created_leads.append((r.json()["id"], admin_tok))

body_m3 = {"client_name": "Spotkanie 3 lata", "status": "umowione", "photo_base64": BIG_PHOTO,
           "latitude": MT_LAT + 0.002, "longitude": MT_LNG + 0.002, "meeting_at": m_3y}
ok, r = post_lead(rep_tok, body_m3, 400)
rec(ok, "meeting_at +3y → 400", f"got {r.status_code} {r.text[:150]}")

body_malformed = {"client_name": "Spotkanie bad", "status": "umowione", "photo_base64": BIG_PHOTO,
                  "latitude": MT_LAT + 0.003, "longitude": MT_LNG + 0.003, "meeting_at": "not a date"}
ok, r = post_lead(rep_tok, body_malformed, 400)
rec(ok, "meeting_at malformed → 400", f"got {r.status_code} {r.text[:150]}")

body_past = {"client_name": "Spotkanie past", "status": "umowione", "photo_base64": BIG_PHOTO,
             "latitude": MT_LAT + 0.004, "longitude": MT_LNG + 0.004, "meeting_at": m_5d_ago}
ok, r = post_lead(rep_tok, body_past, 400)
rec(ok, "meeting_at 5d ago → 400", f"got {r.status_code} {r.text[:150]}")
rec("wczorajsza" in r.text or "wczoraj" in r.text, "Polish 'wcześniejszy niż wczoraj' msg", r.text[:100])

print()
print("=" * 70)
print("4) GET /api/leads/territory-map")
print("=" * 70)

# no auth
r = requests.get(f"{API}/leads/territory-map", timeout=20)
rec(r.status_code == 401, "territory-map no auth → 401", f"got {r.status_code}")

# Create own rep lead at new unique spot with lat/lng to ensure 'is_own' works
TM_LAT = 57.1234 + (int(time.time()) % 500) / 100000.0
TM_LNG = 21.5678 + (int(time.time()) % 500) / 100000.0
body_own = {"client_name": "Lead Rep Territory", "status": "nowy", "photo_base64": BIG_PHOTO,
            "latitude": TM_LAT, "longitude": TM_LNG}
ok, r = post_lead(rep_tok, body_own, 200)
rec(ok, "create own rep lead for territory test → 200", f"got {r.status_code} {r.text[:120]}")
rep_own_lead_id = None
if r.status_code == 200:
    rep_own_lead_id = r.json()["id"]
    created_leads.append((rep_own_lead_id, admin_tok))

# Create 'nie_zainteresowany' lead via admin
body_ni = {"client_name": "Niezainteresowany Testowy", "status": "nie_zainteresowany",
           "latitude": TM_LAT + 0.003, "longitude": TM_LNG + 0.003}
ok, r = post_lead(admin_tok, body_ni, 200)
rec(ok, "admin creates nie_zainteresowany lead → 200", f"got {r.status_code}")
ni_lead_id = None
if r.status_code == 200:
    ni_lead_id = r.json()["id"]
    created_leads.append((ni_lead_id, admin_tok))

for role, tok in [("handlowiec", rep_tok), ("manager", mgr_tok), ("admin", admin_tok)]:
    r = requests.get(f"{API}/leads/territory-map", headers=H(tok), timeout=30)
    rec(r.status_code == 200, f"territory-map as {role} → 200", f"got {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        rec(isinstance(data, list), f"{role}: response is list", type(data).__name__)
        if data:
            item = data[0]
            keys_ok = all(k in item for k in ["id", "lat", "lng", "is_own", "status"])
            rec(keys_ok, f"{role}: item has keys id,lat,lng,is_own,status", str(item)[:150])
        # Check nie_zainteresowany NOT present
        if ni_lead_id:
            ids = {d["id"] for d in data}
            rec(ni_lead_id not in ids, f"{role}: nie_zainteresowany lead NOT in territory", f"ni_id={ni_lead_id}")
        # is_own check for rep
        if role == "handlowiec" and rep_own_lead_id:
            own = next((d for d in data if d["id"] == rep_own_lead_id), None)
            if own:
                rec(own["is_own"] is True, "handlowiec: own lead has is_own=True", str(own))
            # other pins not owned by this rep should be is_own=false
            others = [d for d in data if d["id"] != rep_own_lead_id and d.get("is_own") is True]
            # Could still include other rep's own leads if assigned_to==rep_id (unlikely for admin/manager-created)
        if role == "manager":
            # All leads visible
            # territory should include rep's own lead
            if rep_own_lead_id:
                rec(rep_own_lead_id in {d["id"] for d in data}, "manager: sees rep's lead", "")
            # For manager, is_own should be false for rep's lead (not assigned to manager)
            own = next((d for d in data if d["id"] == rep_own_lead_id), None)
            if own:
                rec(own["is_own"] is False, "manager: rep's lead is_own=False", str(own))

print()
print("=" * 70)
print("5) GET /api/rep/work-status")
print("=" * 70)

# no auth
r = requests.get(f"{API}/rep/work-status", timeout=20)
rec(r.status_code == 401, "work-status no auth → 401", f"got {r.status_code}")

# Stop first (clean slate)
requests.delete(f"{API}/rep/location", headers=H(rep_tok), timeout=20)

r = requests.get(f"{API}/rep/work-status", headers=H(rep_tok), timeout=20)
rec(r.status_code == 200, "work-status as handlowiec (after delete) → 200", f"got {r.status_code}")
if r.status_code == 200:
    ws = r.json()
    rec(ws.get("is_working") is False, "is_working=False after delete", str(ws))
    rec(ws.get("session_seconds") == 0, "session_seconds == 0", str(ws))

# Start session via PUT /rep/location
r = requests.put(f"{API}/rep/location", headers=H(rep_tok),
                 json={"latitude": 54.370, "longitude": 18.630, "battery": 80}, timeout=20)
rec(r.status_code == 200, "PUT /rep/location start session → 200", f"got {r.status_code} {r.text[:150]}")

r = requests.get(f"{API}/rep/work-status", headers=H(rep_tok), timeout=20)
rec(r.status_code == 200, "work-status after start → 200", f"got {r.status_code}")
if r.status_code == 200:
    ws = r.json()
    rec(ws.get("is_working") is True, "is_working=True", str(ws))
    rec(ws.get("session_seconds", -1) >= 0, "session_seconds >= 0", str(ws))

# Move >10m and push another location
r = requests.put(f"{API}/rep/location", headers=H(rep_tok),
                 json={"latitude": 54.3705, "longitude": 18.6305, "battery": 79}, timeout=20)
rec(r.status_code == 200, "PUT /rep/location move >10m → 200", f"got {r.status_code}")
r = requests.get(f"{API}/rep/work-status", headers=H(rep_tok), timeout=20)
if r.status_code == 200:
    ws = r.json()
    rec(ws.get("session_distance_m", 0) > 0, "session_distance_m > 0 after move", str(ws))

# Delete = stop session
r = requests.delete(f"{API}/rep/location", headers=H(rep_tok), timeout=20)
rec(r.status_code == 200, "DELETE /rep/location → 200", f"got {r.status_code}")
r = requests.get(f"{API}/rep/work-status", headers=H(rep_tok), timeout=20)
if r.status_code == 200:
    ws = r.json()
    rec(ws.get("is_working") is False, "is_working=False after stop", str(ws))

# Manager work-status
r = requests.get(f"{API}/rep/work-status", headers=H(mgr_tok), timeout=20)
rec(r.status_code == 200, "work-status as manager → 200", f"got {r.status_code}")

print()
print("=" * 70)
print("6) Session stats in /api/dashboard/manager reps_live")
print("=" * 70)

# Start session & push multiple locations
requests.put(f"{API}/rep/location", headers=H(rep_tok),
             json={"latitude": 54.370, "longitude": 18.630, "battery": 80}, timeout=20)
requests.put(f"{API}/rep/location", headers=H(rep_tok),
             json={"latitude": 54.3715, "longitude": 18.6315, "battery": 79}, timeout=20)
requests.put(f"{API}/rep/location", headers=H(rep_tok),
             json={"latitude": 54.3725, "longitude": 18.6325, "battery": 78}, timeout=20)

time.sleep(2)
r = requests.get(f"{API}/dashboard/manager", headers=H(mgr_tok), timeout=30)
rec(r.status_code == 200, "GET /dashboard/manager → 200", f"got {r.status_code}")
if r.status_code == 200:
    data = r.json()
    reps_live = data.get("reps_live", [])
    rep_entry = next((x for x in reps_live if x.get("user_id") == rep_id), None)
    rec(rep_entry is not None, "handlowiec entry in reps_live", f"live entries: {len(reps_live)}")
    if rep_entry:
        rec("session_seconds" in rep_entry, "reps_live has session_seconds", str(rep_entry)[:200])
        rec("session_distance_m" in rep_entry, "reps_live has session_distance_m", str(rep_entry)[:200])
        rec(rep_entry.get("session_seconds", -1) >= 0, "session_seconds >= 0", str(rep_entry))
        rec(rep_entry.get("session_distance_m", -1) >= 0, "session_distance_m >= 0", str(rep_entry))

print()
print("=" * 70)
print("7) GET /api/users/{user_id}/profile")
print("=" * 70)

# no auth
r = requests.get(f"{API}/users/{rep_id}/profile", timeout=20)
rec(r.status_code == 401, "profile no auth → 401", f"got {r.status_code}")

# Manager → own handlowiec → 200
r = requests.get(f"{API}/users/{rep_id}/profile", headers=H(mgr_tok), timeout=20)
rec(r.status_code == 200, "manager GET own rep profile → 200", f"got {r.status_code} {r.text[:200]}")
if r.status_code == 200:
    p = r.json()
    rec("user" in p and all(k in p["user"] for k in ["id", "email", "name", "role"]),
        "profile.user has id,email,name,role", str(p.get("user"))[:200])
    kpi = p.get("kpi", {})
    required_kpi = ["total_leads", "signed_count", "meeting_count", "session_seconds",
                    "session_distance_m", "is_working", "commission_payable",
                    "commission_frozen", "contracts_count"]
    missing_kpi = [k for k in required_kpi if k not in kpi]
    rec(len(missing_kpi) == 0, f"profile.kpi has all required keys", f"missing: {missing_kpi}")
    rec("status_breakdown" in p, "profile has status_breakdown", str(list(p.keys())))
    rec("leads" in p and isinstance(p["leads"], list), "profile.leads is list", "")
    rec("track" in p and isinstance(p["track"], list), "profile.track is list", "")

# Admin → any handlowiec
r = requests.get(f"{API}/users/{rep_id}/profile", headers=H(admin_tok), timeout=20)
rec(r.status_code == 200, "admin GET any rep profile → 200", f"got {r.status_code}")

r = requests.get(f"{API}/users/{anna_id}/profile", headers=H(admin_tok), timeout=20)
rec(r.status_code == 200, "admin GET anna profile → 200", f"got {r.status_code}")

# Handlowiec → self ok
r = requests.get(f"{API}/users/{rep_id}/profile", headers=H(rep_tok), timeout=20)
rec(r.status_code == 200, "handlowiec GET self → 200", f"got {r.status_code}")

# Handlowiec → another rep → 403
r = requests.get(f"{API}/users/{anna_id}/profile", headers=H(rep_tok), timeout=20)
rec(r.status_code == 403, "handlowiec GET other rep → 403", f"got {r.status_code} {r.text[:120]}")

# Invalid user id → 404
r = requests.get(f"{API}/users/nonexistent-xyz-123/profile", headers=H(admin_tok), timeout=20)
rec(r.status_code == 404, "invalid user_id → 404", f"got {r.status_code}")

print()
print("=" * 70)
print("8) Regression")
print("=" * 70)

# login all 3
for role, email in [("admin", USERS["admin"]), ("manager", USERS["manager"]), ("handlowiec", USERS["handlowiec"])]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=15)
    rec(r.status_code == 200, f"login {role} → 200", f"got {r.status_code}")

r = requests.get(f"{API}/contracts", headers=H(admin_tok), timeout=20)
rec(r.status_code == 200, "GET /contracts (admin) → 200", f"got {r.status_code}")

r = requests.get(f"{API}/dashboard/finance-v2", headers=H(admin_tok), timeout=30)
rec(r.status_code == 200, "GET /dashboard/finance-v2 → 200", f"got {r.status_code}")
if r.status_code == 200:
    f2 = r.json()
    rec("cancelled_contracts" in f2, "finance-v2 has cancelled_contracts bucket", str(list(f2.keys()))[:200])

r = requests.get(f"{API}/calendar/meetings", headers=H(admin_tok), timeout=20)
rec(r.status_code == 200, "GET /calendar/meetings → 200", f"got {r.status_code}")

# PUT /api/rep/location track buffer
r = requests.put(f"{API}/rep/location", headers=H(rep_tok),
                 json={"latitude": 54.3800, "longitude": 18.6400, "battery": 70}, timeout=20)
rec(r.status_code == 200, "PUT /rep/location buffer works → 200", f"got {r.status_code}")
if r.status_code == 200:
    rec("track_len" in r.json(), "response has track_len", str(r.json()))

# GET /api/tracking/track/{rep_id}
r = requests.get(f"{API}/tracking/track/{rep_id}", headers=H(admin_tok), timeout=20)
rec(r.status_code == 200, "GET /tracking/track/{rep_id} (admin) → 200", f"got {r.status_code} {r.text[:150]}")

# Idempotency-Key on POST /contracts — create a lead first, then post contract with key
IDEMP_LAT = 58.1234 + (int(time.time()) % 500) / 100000.0
IDEMP_LNG = 22.5678 + (int(time.time()) % 500) / 100000.0
body_contract_lead = {"client_name": "Klient Kontraktu", "status": "nowy", "photo_base64": BIG_PHOTO,
                      "latitude": IDEMP_LAT, "longitude": IDEMP_LNG,
                      "building_area": 150, "building_type": "mieszkalny"}
ok, r = post_lead(rep_tok, body_contract_lead, 200)
contract_lead_id = None
if r.status_code == 200:
    contract_lead_id = r.json()["id"]
    created_leads.append((contract_lead_id, admin_tok))
if contract_lead_id:
    key = f"phase21-test-{int(time.time())}"
    today = datetime.now(timezone.utc).date().isoformat()
    contract_body = {
        "lead_id": contract_lead_id,
        "signed_at": today,
        "gross_amount": 60000,
        "global_margin": 12000,
        "payment_type": "credit",
    }
    r1 = requests.post(f"{API}/contracts", headers={**H(rep_tok), "Idempotency-Key": key}, json=contract_body, timeout=20)
    rec(r1.status_code == 200, "POST /contracts w/ Idempotency-Key → 200", f"got {r1.status_code} {r1.text[:200]}")
    contract_id_1 = r1.json().get("id") if r1.status_code == 200 else None
    r2 = requests.post(f"{API}/contracts", headers={**H(rep_tok), "Idempotency-Key": key}, json=contract_body, timeout=20)
    rec(r2.status_code == 200, "POST /contracts replay → 200", f"got {r2.status_code}")
    contract_id_2 = r2.json().get("id") if r2.status_code == 200 else None
    rec(contract_id_1 == contract_id_2, "Idempotency: same contract id returned", f"{contract_id_1} vs {contract_id_2}")
    # cleanup contract
    if contract_id_1:
        requests.delete(f"{API}/contracts/{contract_id_1}", headers=H(admin_tok), timeout=20)

print()
print("=" * 70)
print("CLEANUP")
print("=" * 70)
# Stop rep session
requests.delete(f"{API}/rep/location", headers=H(rep_tok), timeout=20)
deleted = 0
for lid, tok in created_leads:
    try:
        r = requests.delete(f"{API}/leads/{lid}", headers=H(tok), timeout=15)
        if r.status_code == 200:
            deleted += 1
    except Exception:
        pass
print(f"Cleaned up {deleted}/{len(created_leads)} leads")

print()
print("=" * 70)
print(f"RESULT: {PASS} PASS / {FAIL} FAIL")
print("=" * 70)
if FAILS:
    print("\nFAILED ASSERTIONS:")
    for f in FAILS:
        print(f"  - {f}")
sys.exit(0 if FAIL == 0 else 1)
