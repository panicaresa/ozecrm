"""
Sprint 5-pre — Manual smoke tests for PUT /api/rep/location/batch
and backward compatibility with PUT /api/rep/location.

Run against the public BASE_URL (EXPO_PUBLIC_BACKEND_URL).
"""
import os
import sys
import json
import requests
from pathlib import Path

# Read public BASE_URL from frontend .env
ENV_PATH = Path("/app/frontend/.env")
BASE_URL = None
for line in ENV_PATH.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not BASE_URL:
    print("ERROR: EXPO_PUBLIC_BACKEND_URL not found")
    sys.exit(1)

API = f"{BASE_URL}/api"
print(f"Using BASE_URL: {BASE_URL}")
print(f"API: {API}\n")

PASS_COUNT = 0
FAIL_COUNT = 0
FAILURES = []

def assert_(cond, label):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        PASS_COUNT += 1
        print(f"  ✅ {label}")
    else:
        FAIL_COUNT += 1
        FAILURES.append(label)
        print(f"  ❌ {label}")

def login(email, password="test1234"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]

# ----- login as roles -----
print("=== Login ===")
admin_tok = login("admin@test.com")
manager_tok = login("manager@test.com")
hand_tok = login("handlowiec@test.com")
print("  admin/manager/handlowiec tokens obtained\n")

H = lambda tok: {"Authorization": f"Bearer {tok}"}

def cleanup_tracking():
    """Stop tracking so subsequent tests start clean."""
    requests.delete(f"{API}/rep/location", headers=H(hand_tok), timeout=15)

# Pre-clean
cleanup_tracking()

# ============================================================
# Scenario (a) — unauthenticated → 401
# ============================================================
print("=== (a) PUT /api/rep/location/batch unauthenticated → 401 ===")
r = requests.put(
    f"{API}/rep/location/batch",
    json={"points": [{"latitude": 52.0, "longitude": 21.0, "accuracy": 5}]},
    timeout=15,
)
assert_(r.status_code == 401, f"Status 401 (got {r.status_code})")
print()

# ============================================================
# Scenario (b) — empty list → 400
# ============================================================
print("=== (b) Empty {points: []} as handlowiec → 400 with Polish error ===")
r = requests.put(
    f"{API}/rep/location/batch",
    headers=H(hand_tok),
    json={"points": []},
    timeout=15,
)
assert_(r.status_code == 400, f"Status 400 (got {r.status_code}, body={r.text[:200]})")
body_text = r.text.lower()
assert_(
    "co najmniej 1" in body_text or "1 punkt" in body_text or "co najmniej" in body_text,
    f'Response contains Polish error about "co najmniej 1" / "1 punkt" (got: {r.text[:200]})',
)
print()

# ============================================================
# Scenario (c) — 5 distinct points → all appended
# ============================================================
print("=== (c) 5 distinct points → 200, received=5, appended=5, track_len>=5 ===")
cleanup_tracking()  # Pre-clean per spec
points_5 = [
    {"latitude": 52.10, "longitude": 21.00, "accuracy": 5},
    {"latitude": 52.101, "longitude": 21.00, "accuracy": 5},
    {"latitude": 52.102, "longitude": 21.00, "accuracy": 5},
    {"latitude": 52.103, "longitude": 21.00, "accuracy": 5},
    {"latitude": 52.104, "longitude": 21.00, "accuracy": 5},
]
r = requests.put(
    f"{API}/rep/location/batch",
    headers=H(hand_tok),
    json={"points": points_5},
    timeout=15,
)
assert_(r.status_code == 200, f"Status 200 (got {r.status_code}, body={r.text[:200]})")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {json.dumps(j, ensure_ascii=False)}")
    assert_(j.get("ok") is True, "ok=true")
    assert_(j.get("received") == 5, f"received=5 (got {j.get('received')})")
    assert_(j.get("appended") == 5, f"appended=5 (got {j.get('appended')})")
    assert_(j.get("track_len", 0) >= 5, f"track_len>=5 (got {j.get('track_len')})")
print()

# ============================================================
# Scenario (d) — 4 near-identical points (~0.5m apart) → appended <= 1 (3 deduped)
# ============================================================
print("=== (d) 4 near-identical points (~0.5m apart) → 200, appended <= 1 ===")
cleanup_tracking()  # Clean
# 0.5m latitude difference is roughly 0.0000045 degrees (1 deg lat ≈ 111000m)
points_near = [
    {"latitude": 52.1000000, "longitude": 21.0000000, "accuracy": 5},
    {"latitude": 52.1000045, "longitude": 21.0000000, "accuracy": 5},  # ~0.5m
    {"latitude": 52.1000090, "longitude": 21.0000000, "accuracy": 5},  # ~1m total
    {"latitude": 52.1000135, "longitude": 21.0000000, "accuracy": 5},  # ~1.5m total
]
r = requests.put(
    f"{API}/rep/location/batch",
    headers=H(hand_tok),
    json={"points": points_near},
    timeout=15,
)
assert_(r.status_code == 200, f"Status 200 (got {r.status_code}, body={r.text[:200]})")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {json.dumps(j, ensure_ascii=False)}")
    assert_(j.get("received") == 4, f"received=4 (got {j.get('received')})")
    appended = j.get("appended", -1)
    assert_(appended <= 1, f"appended<=1 (3 deduped) (got {appended})")
print()

# ============================================================
# Scenario (e) — 101 points → 400 with "100" in error
# ============================================================
print("=== (e) 101 points → 400 with '100' in error ===")
points_101 = [
    {"latitude": 52.0 + i * 0.001, "longitude": 21.0, "accuracy": 5}
    for i in range(101)
]
r = requests.put(
    f"{API}/rep/location/batch",
    headers=H(hand_tok),
    json={"points": points_101},
    timeout=15,
)
assert_(r.status_code == 400, f"Status 400 (got {r.status_code}, body={r.text[:200]})")
assert_("100" in r.text, f'Response contains "100" (got: {r.text[:200]})')
print()

# ============================================================
# Scenario (f) — BACKWARD COMPAT: PUT /api/rep/location single-point
# ============================================================
print("=== (f) Backward compat: single-point PUT /api/rep/location → 200 with track_len ===")
cleanup_tracking()
r = requests.put(
    f"{API}/rep/location",
    headers=H(hand_tok),
    json={"latitude": 52.20, "longitude": 21.05, "accuracy": 5},
    timeout=15,
)
assert_(r.status_code == 200, f"Status 200 (got {r.status_code}, body={r.text[:200]})")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {json.dumps(j, ensure_ascii=False)}")
    assert_("track_len" in j, f'response contains "track_len" key (got keys: {list(j.keys())})')
    assert_(j.get("track_len", 0) >= 1, f"track_len>=1 (got {j.get('track_len')})")
print()

# ============================================================
# Scenario (3) — Manager dashboard reflects last batch point (52.104)
# ============================================================
print("=== (3) Manager dashboard reps_live reflects LAST batch point (52.104) ===")
cleanup_tracking()
# Re-upload the 5-point batch from (c)
r = requests.put(
    f"{API}/rep/location/batch",
    headers=H(hand_tok),
    json={"points": points_5},
    timeout=15,
)
assert_(r.status_code == 200, f"Re-upload batch 200 (got {r.status_code})")

# Get user id of handlowiec
me = requests.get(f"{API}/auth/me", headers=H(hand_tok), timeout=15).json()
hand_user_id = me["id"]
print(f"  handlowiec user id: {hand_user_id}")

# Get manager dashboard
r = requests.get(f"{API}/dashboard/manager", headers=H(manager_tok), timeout=15)
assert_(r.status_code == 200, f"Manager dashboard 200 (got {r.status_code})")
if r.status_code == 200:
    dash = r.json()
    reps_live = dash.get("reps_live", [])
    print(f"  reps_live count: {len(reps_live)}")
    found = None
    for rep in reps_live:
        if rep.get("rep_id") == hand_user_id or rep.get("user_id") == hand_user_id or rep.get("id") == hand_user_id:
            found = rep
            break
    if not found:
        # Search by name fallback
        for rep in reps_live:
            print(f"    rep entry keys: {list(rep.keys())} -> {rep}")
        assert_(False, "Found handlowiec entry in reps_live")
    else:
        print(f"  found rep_live entry: {found}")
        lat = found.get("lat") or found.get("latitude")
        assert_(
            lat is not None and abs(float(lat) - 52.104) < 1e-4,
            f"reps_live[].lat == 52.104 (got {lat})",
        )

# Final cleanup
cleanup_tracking()

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
print(f"PASS: {PASS_COUNT}  FAIL: {FAIL_COUNT}")
if FAILURES:
    print("Failures:")
    for f in FAILURES:
        print(f"  - {f}")
sys.exit(0 if FAIL_COUNT == 0 else 1)
