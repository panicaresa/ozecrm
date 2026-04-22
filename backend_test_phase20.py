"""
Phase 2.0 + Mini-sprint (Y1/C1) backend tests.

Tests:
  Y1) /api/dashboard/finance-v2 excludes cancelled contracts from aggregates
  C1) cancelled_contracts bucket visibility (admin/manager/handlowiec scope)
  2.0) rep_locations polyline with haversine dedupe + MAX_TRACK_POINTS cap
  2.0) GET /api/tracking/track/{rep_id} role-scoped
  2.0) WebSocket /ws/rep-locations auth + broadcast scope
  Regression: login, contracts CRUD, calendar/meetings, finance-v2, Idempotency-Key
"""
import asyncio
import json
import os
import sys
import uuid
import time
from typing import Optional

import requests
import websockets

BASE_REST = "https://renewable-sales-hub.preview.emergentagent.com/api"
WS_URL = "ws://localhost:8001/ws/rep-locations"

PW = "test1234"
ACCOUNTS = {
    "admin": "admin@test.com",
    "manager": "manager@test.com",
    "handlowiec": "handlowiec@test.com",
    "anna": "anna@test.com",  # another handlowiec for scope tests
}

FAILS = []
PASSES = 0


def check(cond: bool, label: str, detail: str = ""):
    global PASSES
    if cond:
        PASSES += 1
        print(f"✅ {label}")
    else:
        FAILS.append(f"{label} — {detail}")
        print(f"❌ {label}  [{detail}]")


def login(email: str):
    r = requests.post(f"{BASE_REST}/auth/login", json={"email": email, "password": PW}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def hdr(tok, extra=None):
    h = auth(tok)
    if extra:
        h.update(extra)
    return h


# ─────────────────────── LOGIN ───────────────────────────────────────────────
tokens = {}
users = {}
for role, email in ACCOUNTS.items():
    tok, u = login(email)
    tokens[role] = tok
    users[role] = u
    check(u["email"] == email, f"Login {role} ({email})")

admin_tok = tokens["admin"]
manager_tok = tokens["manager"]
rep_tok = tokens["handlowiec"]
anna_tok = tokens["anna"]
rep_id = users["handlowiec"]["id"]
anna_id = users["anna"]["id"]


# ─────────────────── SETUP: create a lead for handlowiec, then contract ─────
def create_lead(tok, client_name: str):
    body = {
        "client_name": client_name,
        "phone": "+48 500 111 222",
        "address": "Gdańsk, Testowa 1",
        "latitude": 54.372,
        "longitude": 18.638,
        "building_area": 150.0,
        "building_type": "mieszkalny",
        "status": "nowy",
    }
    r = requests.post(f"{BASE_REST}/leads", headers=auth(tok), json=body, timeout=20)
    assert r.status_code == 200, f"create lead: {r.status_code} {r.text}"
    return r.json()["id"]


def create_contract(tok, lead_id: str, gross: float, margin: float, idem: Optional[str] = None):
    now_iso = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    body = {
        "lead_id": lead_id,
        "signed_at": now_iso,
        "buildings_count": 1,
        "building_type": "mieszkalny",
        "roof_area_m2": 120.0,
        "gross_amount": gross,
        "global_margin": margin,
        "financing_type": "credit",
        "note": "Y1/C1 test contract",
    }
    extra = {"Idempotency-Key": idem} if idem else None
    r = requests.post(f"{BASE_REST}/contracts", headers=hdr(tok, extra), json=body, timeout=20)
    assert r.status_code == 200, f"create contract: {r.status_code} {r.text}"
    return r.json()


print("\n=== SETUP: create contracts A & B ===")
lead_a = create_lead(rep_tok, "Y1 Contract A Client")
lead_b = create_lead(rep_tok, "Y1 Contract B Client")
contract_a = create_contract(rep_tok, lead_a, 100000.0, 20000.0, idem=str(uuid.uuid4()))
contract_b = create_contract(rep_tok, lead_b, 50000.0, 10000.0, idem=str(uuid.uuid4()))
contract_a_id = contract_a["id"]
contract_b_id = contract_b["id"]
print(f"contract_A id={contract_a_id} commission_amount={contract_a.get('commission_amount')}")
print(f"contract_B id={contract_b_id} commission_amount={contract_b.get('commission_amount')}")
check(contract_a["commission_amount"] == 10000.0, "contract_A commission_amount=10000 (50% × 20000)",
      f"got {contract_a.get('commission_amount')}")
check(contract_b["commission_amount"] == 5000.0, "contract_B commission_amount=5000 (50% × 10000)",
      f"got {contract_b.get('commission_amount')}")


# ────────── Y1: finance-v2 excludes cancelled from aggregates ─────────
print("\n=== Y1: baseline finance-v2 (admin) ===")
r = requests.get(f"{BASE_REST}/dashboard/finance-v2", headers=auth(admin_tok), timeout=20)
check(r.status_code == 200, "GET finance-v2 admin 200", f"got {r.status_code}")
base = r.json()
check("cancelled_contracts" in base, "cancelled_contracts key present in response",
      f"keys={list(base.keys())}")
base_totals = base["totals_month"]
base_brutto = float(base_totals.get("brutto_sum") or 0)
base_margin = float(base_totals.get("margin_sum") or 0)
base_payable = float(base_totals.get("commission_payable_sum") or 0)
base_frozen = float(base_totals.get("commission_frozen_sum") or 0)
base_signed = int(base_totals.get("signed_count") or 0)
base_cancelled_count = int(base_totals.get("cancelled_count") or 0)
print(f"baseline: brutto={base_brutto} margin={base_margin} payable={base_payable} frozen={base_frozen} signed={base_signed} cancelled_count={base_cancelled_count}")

# Sanity: contract_A should be in frozen (signed today, credit, <14d)
frozen_ids = {c["id"] for c in base.get("frozen_contracts", [])}
check(contract_a_id in frozen_ids, "contract_A appears in frozen_contracts (fresh credit <14d)")
check(contract_b_id in frozen_ids, "contract_B appears in frozen_contracts (fresh credit <14d)")

# Expected commission of contract_A: 50% of 20000 = 10000 → all frozen
ca_commission = 10000.0

# PATCH contract_A cancelled=true as admin
r = requests.patch(f"{BASE_REST}/contracts/{contract_a_id}",
                   headers=auth(admin_tok), json={"cancelled": True}, timeout=20)
check(r.status_code == 200, "PATCH contract_A cancelled=true (admin)", f"got {r.status_code} {r.text[:200]}")
patched = r.json()
check(patched.get("status") == "cancelled", "contract_A.status==cancelled after PATCH",
      f"got {patched.get('status')}")

# Re-fetch
r = requests.get(f"{BASE_REST}/dashboard/finance-v2", headers=auth(admin_tok), timeout=20)
check(r.status_code == 200, "GET finance-v2 admin 200 after cancel")
after = r.json()
after_totals = after["totals_month"]

after_brutto = float(after_totals.get("brutto_sum") or 0)
after_margin = float(after_totals.get("margin_sum") or 0)
after_payable = float(after_totals.get("commission_payable_sum") or 0)
after_frozen = float(after_totals.get("commission_frozen_sum") or 0)
after_signed = int(after_totals.get("signed_count") or 0)
after_cancelled_count = int(after_totals.get("cancelled_count") or 0)
print(f"after cancel: brutto={after_brutto} margin={after_margin} payable={after_payable} frozen={after_frozen} signed={after_signed} cancelled_count={after_cancelled_count}")

check(abs((base_brutto - after_brutto) - 100000.0) < 0.01,
      "brutto_sum decreased by 100000",
      f"delta={base_brutto - after_brutto}")
check(abs((base_margin - after_margin) - 20000.0) < 0.01,
      "margin_sum decreased by 20000",
      f"delta={base_margin - after_margin}")
# contract_A was frozen (within 14d) so commission_frozen should drop by 10000
check(abs((base_frozen - after_frozen) - ca_commission) < 0.01,
      "commission_frozen_sum decreased by 10000",
      f"delta={base_frozen - after_frozen}")
# commission_payable_sum was 0 for contract_A (frozen), so it shouldn't change due to A,
# but may have changed for other reasons — we just verify it didn't INCREASE
check(after_payable <= base_payable + 0.01,
      "commission_payable_sum did not increase after cancelling frozen contract_A",
      f"before={base_payable} after={after_payable}")
check(base_signed - after_signed == 1,
      "signed_count decreased by exactly 1",
      f"before={base_signed} after={after_signed}")
check(after_cancelled_count - base_cancelled_count == 1,
      "cancelled_count increased by exactly 1",
      f"before={base_cancelled_count} after={after_cancelled_count}")

# cancelled_contracts bucket contains A
cancelled_ids = {c["id"] for c in after.get("cancelled_contracts", [])}
check(contract_a_id in cancelled_ids, "cancelled_contracts contains contract_A",
      f"ids={cancelled_ids}")

# contract_A NOT in frozen/partial/payable
after_frozen_ids = {c["id"] for c in after.get("frozen_contracts", [])}
after_partial_ids = {c["id"] for c in after.get("partial_contracts", [])}
after_payable_ids = {c["id"] for c in after.get("payable_contracts", [])}
check(contract_a_id not in after_frozen_ids, "contract_A NOT in frozen_contracts after cancel")
check(contract_a_id not in after_partial_ids, "contract_A NOT in partial_contracts after cancel")
check(contract_a_id not in after_payable_ids, "contract_A NOT in payable_contracts after cancel")


# ─────────── C1: cancelled_contracts visibility across roles ─────────────
print("\n=== C1: cancelled_contracts visibility (handlowiec/manager) ===")
r = requests.get(f"{BASE_REST}/dashboard/finance-v2", headers=auth(rep_tok), timeout=20)
check(r.status_code == 200, "GET finance-v2 handlowiec 200")
rep_fin = r.json()
rep_cancelled_ids = {c["id"] for c in rep_fin.get("cancelled_contracts", [])}
check(contract_a_id in rep_cancelled_ids, "handlowiec.cancelled_contracts contains contract_A (own)",
      f"ids={rep_cancelled_ids}")

r = requests.get(f"{BASE_REST}/dashboard/finance-v2", headers=auth(manager_tok), timeout=20)
check(r.status_code == 200, "GET finance-v2 manager 200")
mgr_fin = r.json()
mgr_cancelled_ids = {c["id"] for c in mgr_fin.get("cancelled_contracts", [])}
check(contract_a_id in mgr_cancelled_ids, "manager.cancelled_contracts contains contract_A (team)",
      f"ids={mgr_cancelled_ids}")


# ─────────── 2.0: rep_locations polyline dedupe + cap ──────────────────
print("\n=== 2.0: rep_locations track polyline ===")
# Reset: ensure starting fresh by first DELETEing, then ensure a fresh PUT starts new track
# The track reset happens only at UTC midnight; we can't clear mid-day, so we'll work with
# the existing track length and measure deltas.
# To make assertions deterministic, first clear track by letting is_active=false then
# retry by posting many points — but track buffer persists. So instead measure DELTA.

def put_loc(tok, lat, lng, battery=0.85):
    r = requests.put(f"{BASE_REST}/rep/location",
                     headers=auth(tok),
                     json={"latitude": lat, "longitude": lng,
                           "battery": battery, "battery_state": "unplugged"},
                     timeout=20)
    return r


# We capture baseline track_len first
r = put_loc(rep_tok, 54.370, 18.630)
check(r.status_code == 200, "PUT /rep/location #1 → 200", f"{r.status_code} {r.text[:200]}")
t0 = r.json().get("track_len")
print(f"baseline track_len={t0}")
check(isinstance(t0, int) and t0 >= 1, "track_len is int >= 1", f"got {t0}")

# duplicate near-identical point (<1m) should be DEDUPED
r = put_loc(rep_tok, 54.3700001, 18.6300001)
check(r.status_code == 200, "PUT /rep/location #1-dup → 200")
t1 = r.json().get("track_len")
check(t1 == t0, f"dup <1m DEDUPED (track_len unchanged: {t0}→{t1})")

# distinct > 10m: lat diff 0.01 ≈ 1.1km
r = put_loc(rep_tok, 54.380, 18.640)
check(r.status_code == 200, "PUT /rep/location #2 → 200")
t2 = r.json().get("track_len")
check(t2 == t1 + 1, f"distinct >10m APPENDED (track_len {t1}→{t2})")

# Now push many distinct points to test cap
print("pushing 500 distinct points (fast)...")
sess = requests.Session()
sess.headers.update(auth(rep_tok))
last_track_len = t2
start = time.time()
BATCH = 500
for i in range(BATCH):
    lat = 55.0 + 0.001 * (i + 1)  # each 0.001 lat ≈ 111m > 10m → always appended
    lng = 19.0 + 0.001 * (i + 1)
    r = sess.put(f"{BASE_REST}/rep/location",
                 json={"latitude": lat, "longitude": lng,
                       "battery": 0.80, "battery_state": "unplugged"},
                 timeout=15)
    if r.status_code != 200:
        check(False, f"PUT point #{i}", f"{r.status_code} {r.text[:200]}")
        break
    last_track_len = r.json().get("track_len", last_track_len)
print(f"pushed {BATCH} points in {time.time() - start:.1f}s. final track_len={last_track_len}")

check(last_track_len == 500, f"track_len capped at MAX_TRACK_POINTS=500 (got {last_track_len})",
      f"got {last_track_len}")

# DELETE /api/rep/location
r = requests.delete(f"{BASE_REST}/rep/location", headers=auth(rep_tok), timeout=15)
check(r.status_code == 200, "DELETE /rep/location → 200", f"got {r.status_code}")
# Verify is_active=false via admin GET /api/tracking/track (contains is_active)
r = requests.get(f"{BASE_REST}/tracking/track/{rep_id}", headers=auth(admin_tok), timeout=15)
check(r.status_code == 200, "GET /tracking/track as admin → 200")
tk = r.json()
check(tk.get("is_active") is False, "rep is_active=false after DELETE (not deleted, soft-stop)",
      f"is_active={tk.get('is_active')}")


# ─────────── 2.0: GET /api/tracking/track/{rep_id} scope ────────────────
print("\n=== 2.0: GET /api/tracking/track/{rep_id} ===")
r = requests.get(f"{BASE_REST}/tracking/track/{rep_id}", headers=auth(rep_tok), timeout=15)
check(r.status_code == 200, "handlowiec GET own track → 200", f"{r.status_code}")
body = r.json()
for k in ["rep_id", "track", "latitude", "longitude", "is_active", "updated_at"]:
    check(k in body, f"response has key '{k}'")

r = requests.get(f"{BASE_REST}/tracking/track/{rep_id}", headers=auth(admin_tok), timeout=15)
check(r.status_code == 200, "admin GET handlowiec track → 200")

r = requests.get(f"{BASE_REST}/tracking/track/{rep_id}", headers=auth(manager_tok), timeout=15)
check(r.status_code == 200, "manager (of handlowiec) GET track → 200")

# handlowiec requesting OTHER handlowiec's track → 403
r = requests.get(f"{BASE_REST}/tracking/track/{anna_id}", headers=auth(rep_tok), timeout=15)
check(r.status_code == 403, "handlowiec GET other rep's track → 403", f"got {r.status_code}")


# ─────────── 2.0: WebSocket auth ────────────────────────────────────
print("\n=== 2.0: WebSocket auth ===")


async def ws_auth_tests():
    # (a) No token sent within 5s → connection closes
    try:
        async with websockets.connect(WS_URL, open_timeout=10) as ws:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=7.0)
                # Should either close (ConnectionClosed) or return nothing meaningful
                check(False, "WS without token within 5s → close",
                      f"unexpectedly received: {msg[:100]}")
            except websockets.ConnectionClosed as e:
                check(True, f"WS without token within 5s → closed (code {e.code})")
            except asyncio.TimeoutError:
                check(False, "WS without token → recv timed out (expected close)")
    except Exception as e:
        check(False, "WS no-token connect", str(e))

    # (b) Invalid token
    try:
        async with websockets.connect(WS_URL, open_timeout=10) as ws:
            await ws.send(json.dumps({"token": "garbage.jwt.here"}))
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = json.loads(msg)
            check(data.get("type") == "auth_error",
                  f"WS invalid token → auth_error (type={data.get('type')})")
            try:
                await asyncio.wait_for(ws.recv(), timeout=3.0)
                check(False, "WS after auth_error should close", "still open")
            except websockets.ConnectionClosed:
                check(True, "WS invalid token closed after auth_error")
            except asyncio.TimeoutError:
                check(False, "WS invalid token did not close within 3s")
    except Exception as e:
        check(False, "WS invalid token connect", str(e))

    # (c) Valid admin token → auth_ok + snapshot
    try:
        async with websockets.connect(WS_URL, open_timeout=10) as ws:
            await ws.send(json.dumps({"token": admin_tok}))
            msg1 = await asyncio.wait_for(ws.recv(), timeout=5.0)
            d1 = json.loads(msg1)
            check(d1.get("type") == "auth_ok",
                  "WS admin auth_ok", f"got {d1.get('type')}")
            msg2 = await asyncio.wait_for(ws.recv(), timeout=5.0)
            d2 = json.loads(msg2)
            check(d2.get("type") == "snapshot",
                  "WS admin snapshot follows", f"got {d2.get('type')}")
            check(isinstance(d2.get("locations"), list),
                  "snapshot.locations is array",
                  f"type={type(d2.get('locations'))}")
    except Exception as e:
        check(False, "WS admin connect", str(e))


asyncio.run(ws_auth_tests())


# ─────────── 2.0: WebSocket broadcast scope ─────────────────────
print("\n=== 2.0: WebSocket broadcast ===")


async def ws_broadcast_tests():
    recv_admin = []
    recv_manager = []
    recv_anna = []
    done_admin = asyncio.Event()
    done_manager = asyncio.Event()
    done_anna = asyncio.Event()

    async def client(tok, recv_list, done_evt, label):
        try:
            async with websockets.connect(WS_URL, open_timeout=10) as ws:
                await ws.send(json.dumps({"token": tok}))
                # auth_ok
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                if m.get("type") != "auth_ok":
                    print(f"[{label}] unexpected first msg: {m}")
                    done_evt.set()
                    return
                # maybe snapshot (admin/manager) — skip for handlowiec
                try:
                    while True:
                        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=10.0))
                        recv_list.append(m)
                        if m.get("type") == "location_stop":
                            break
                except asyncio.TimeoutError:
                    pass
                except websockets.ConnectionClosed:
                    pass
        except Exception as e:
            print(f"[{label}] ws error: {e}")
        finally:
            done_evt.set()

    # Start 3 listeners
    t_admin = asyncio.create_task(client(admin_tok, recv_admin, done_admin, "admin"))
    t_manager = asyncio.create_task(client(manager_tok, recv_manager, done_manager, "manager"))
    t_anna = asyncio.create_task(client(anna_tok, recv_anna, done_anna, "anna"))
    # Give them time to authenticate
    await asyncio.sleep(2.0)

    # Trigger PUT /rep/location as handlowiec (sync req in executor)
    loop = asyncio.get_event_loop()
    def _do_put():
        return requests.put(f"{BASE_REST}/rep/location",
                            headers=auth(rep_tok),
                            json={"latitude": 54.5, "longitude": 18.7,
                                  "battery": 0.6, "battery_state": "unplugged"},
                            timeout=10)
    r = await loop.run_in_executor(None, _do_put)
    check(r.status_code == 200, "PUT /rep/location (handlowiec) for broadcast → 200",
          f"{r.status_code}")

    # Wait for broadcast propagation
    await asyncio.sleep(2.0)

    # Now DELETE (stop) to end
    def _do_del():
        return requests.delete(f"{BASE_REST}/rep/location", headers=auth(rep_tok), timeout=10)
    r = await loop.run_in_executor(None, _do_del)
    check(r.status_code == 200, "DELETE /rep/location for broadcast → 200",
          f"{r.status_code}")

    # give time for location_stop to propagate
    await asyncio.sleep(2.0)

    # cancel/close listeners
    for t in (t_admin, t_manager, t_anna):
        if not t.done():
            t.cancel()
    try:
        await asyncio.wait_for(asyncio.gather(t_admin, t_manager, t_anna, return_exceptions=True),
                               timeout=5.0)
    except Exception:
        pass

    def has_update_for_rep(msgs, rid):
        return any(m.get("type") == "location_update" and m.get("rep_id") == rid for m in msgs)

    def has_stop_for_rep(msgs, rid):
        return any(m.get("type") == "location_stop" and m.get("rep_id") == rid for m in msgs)

    check(has_update_for_rep(recv_admin, rep_id),
          "admin WS received location_update for handlowiec",
          f"msgs={[m.get('type') for m in recv_admin]}")
    check(has_update_for_rep(recv_manager, rep_id),
          "manager WS received location_update for handlowiec",
          f"msgs={[m.get('type') for m in recv_manager]}")
    check(not has_update_for_rep(recv_anna, rep_id),
          "anna (other handlowiec) did NOT receive location_update for handlowiec",
          f"msgs={[m.get('type') for m in recv_anna]}")

    check(has_stop_for_rep(recv_admin, rep_id),
          "admin WS received location_stop for handlowiec")
    check(has_stop_for_rep(recv_manager, rep_id),
          "manager WS received location_stop for handlowiec")


asyncio.run(ws_broadcast_tests())


# ─────────── REGRESSION ─────────────────────────────────────
print("\n=== Regression ===")
for role, tok in tokens.items():
    r = requests.get(f"{BASE_REST}/auth/me", headers=auth(tok), timeout=10)
    check(r.status_code == 200, f"GET /auth/me as {role} → 200", f"{r.status_code}")

r = requests.get(f"{BASE_REST}/contracts", headers=auth(admin_tok), timeout=15)
check(r.status_code == 200, "GET /contracts admin → 200")

r = requests.get(f"{BASE_REST}/calendar/meetings", headers=auth(admin_tok), timeout=15)
check(r.status_code == 200, "GET /calendar/meetings admin → 200")

r = requests.get(f"{BASE_REST}/dashboard/finance-v2", headers=auth(admin_tok), timeout=15)
check(r.status_code == 200, "GET /dashboard/finance-v2 admin → 200")

# Idempotency-Key replay check
idem_key = str(uuid.uuid4())
tmp_lead = create_lead(rep_tok, "Idempotency Test Client")
c1 = create_contract(rep_tok, tmp_lead, 30000.0, 5000.0, idem=idem_key)
c2 = create_contract(rep_tok, tmp_lead, 30000.0, 5000.0, idem=idem_key)
check(c1["id"] == c2["id"], "Idempotency-Key replay returns SAME contract id",
      f"c1={c1['id']} c2={c2['id']}")


# ─────────── CLEANUP ────────────────────────────────────────
print("\n=== Cleanup ===")
# Delete all test contracts+leads
for cid in (contract_a_id, contract_b_id, c1["id"]):
    r = requests.delete(f"{BASE_REST}/contracts/{cid}", headers=auth(admin_tok), timeout=10)
    # 200 or 404 OK
    ok = r.status_code in (200, 404)
    check(ok, f"DELETE contract {cid[:8]} → {r.status_code}", r.text[:100] if not ok else "")
for lid in (lead_a, lead_b, tmp_lead):
    r = requests.delete(f"{BASE_REST}/leads/{lid}", headers=auth(admin_tok), timeout=10)
    ok = r.status_code in (200, 404)
    check(ok, f"DELETE lead {lid[:8]} → {r.status_code}", r.text[:100] if not ok else "")


# ─────────── SUMMARY ──────────────────────────────────────
print("\n" + "=" * 70)
print(f"Results: {PASSES} passed, {len(FAILS)} failed")
if FAILS:
    print("\nFailures:")
    for f in FAILS:
        print(f"  - {f}")
    sys.exit(1)
print("ALL PHASE 2.0 + Y1/C1 TESTS PASSED")
