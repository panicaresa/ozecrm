"""
Phase 1.8 backend tests: admin corrections on contracts + GET /api/contracts/{id}
"""
import os
import sys
import json
from datetime import datetime, timezone, timedelta

import requests

BASE = os.environ.get("BACKEND_URL") or "https://renewable-sales-hub.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

PASSED = 0
FAILED = 0
ERRORS = []


def _check(cond, msg):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS  {msg}")
    else:
        FAILED += 1
        ERRORS.append(msg)
        print(f"  FAIL  {msg}")


def login(email, password="test1234"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


def auth(t):
    return {"Authorization": f"Bearer {t}"}


def main():
    created_contract_ids = []
    created_lead_ids = []
    created_user_ids = []
    patched_lead_statuses = {}  # lead_id -> original status
    contract_id_X_original_state = None

    print("=== 1) Quick regression ===")
    admin_tok, admin_u = login("admin@test.com")
    mgr_tok, mgr_u = login("manager@test.com")
    hand_tok, hand_u = login("handlowiec@test.com")
    print(f"  admin id={admin_u['id']} mgr id={mgr_u['id']} hand id={hand_u['id']}")
    _check(admin_u["role"] == "admin", "admin login role")
    _check(mgr_u["role"] == "manager", "manager login role")
    _check(hand_u["role"] == "handlowiec", "handlowiec login role")

    for tok, role in [(admin_tok, "admin"), (mgr_tok, "manager"), (hand_tok, "handlowiec")]:
        r = requests.get(f"{API}/auth/me", headers=auth(tok), timeout=30)
        _check(r.status_code == 200, f"GET /auth/me as {role} == 200")

    for tok, role in [(admin_tok, "admin"), (mgr_tok, "manager"), (hand_tok, "handlowiec")]:
        r = requests.get(f"{API}/settings", headers=auth(tok), timeout=30)
        _check(r.status_code == 200, f"GET /settings as {role} == 200")

    print("\n=== 2) GET /api/contracts/{id} role scope + response shape ===")
    # Find or create a contract assigned to handlowiec
    r = requests.get(f"{API}/contracts", headers=auth(admin_tok), timeout=30)
    _check(r.status_code == 200, "GET /contracts admin == 200")
    all_contracts = r.json()
    print(f"  found {len(all_contracts)} total contracts")

    contract_for_hand = None
    for c in all_contracts:
        if c.get("rep_id") == hand_u["id"] and not c.get("cancelled"):
            contract_for_hand = c
            break

    if not contract_for_hand:
        # Create one. First, find a lead for handlowiec.
        r = requests.get(f"{API}/leads", headers=auth(hand_tok), timeout=30)
        leads = r.json() if r.status_code == 200 else []
        lead_for_hand = None
        for l in leads:
            if l.get("assigned_to") == hand_u["id"]:
                lead_for_hand = l
                break
        if not lead_for_hand:
            # Create lead as admin assigned to handlowiec
            r = requests.post(
                f"{API}/leads",
                headers=auth(admin_tok),
                json={
                    "client_name": "Test Klient Handlowiec",
                    "phone": "+48 500 111 222",
                    "address": "ul. Testowa 1, Gdańsk",
                    "postal_code": "80-309",
                    "latitude": 54.372,
                    "longitude": 18.638,
                    "building_area": 180.0,
                    "building_type": "mieszkalny",
                    "status": "nowy",
                    "assigned_to": hand_u["id"],
                },
                timeout=30,
            )
            assert r.status_code == 200, f"create lead: {r.status_code} {r.text}"
            lead_for_hand = r.json()
            created_lead_ids.append(lead_for_hand["id"])
        # Create contract for this lead
        r = requests.post(
            f"{API}/contracts",
            headers=auth(admin_tok),
            json={
                "lead_id": lead_for_hand["id"],
                "signed_at": (datetime.now(timezone.utc) - timedelta(days=20)).isoformat(),
                "buildings_count": 1,
                "building_type": "mieszkalny",
                "roof_area_m2": 180.0,
                "gross_amount": 120000.0,
                "global_margin": 12000.0,
                "financing_type": "credit",
                "note": "Phase 1.8 seed contract",
            },
            timeout=30,
        )
        assert r.status_code == 200, f"create contract: {r.status_code} {r.text}"
        contract_for_hand = r.json()
        created_contract_ids.append(contract_for_hand["id"])

    contract_id_X = contract_for_hand["id"]
    print(f"  contract_id_X = {contract_id_X}")

    # GET as admin
    r = requests.get(f"{API}/contracts/{contract_id_X}", headers=auth(admin_tok), timeout=30)
    _check(r.status_code == 200, "GET contract as admin == 200")
    if r.status_code == 200:
        body = r.json()
        required = [
            "id", "lead_id", "client_name", "rep_id", "signed_at", "gross_amount",
            "global_margin", "commission_percent", "commission_amount",
            "commission_total", "commission_total_original", "effective_margin",
            "additional_costs", "additional_costs_note",
            "commission_released", "commission_frozen", "paid_pct",
            "release_date", "days_until_release", "status",
        ]
        for f in required:
            _check(f in body, f"response has field '{f}'")

    # GET as manager (owning handlowiec = manager_id)
    r = requests.get(f"{API}/contracts/{contract_id_X}", headers=auth(mgr_tok), timeout=30)
    _check(r.status_code == 200, "GET contract as manager (owning rep) == 200")

    # GET as handlowiec (rep_id==theirs)
    r = requests.get(f"{API}/contracts/{contract_id_X}", headers=auth(hand_tok), timeout=30)
    _check(r.status_code == 200, "GET contract as handlowiec (own) == 200")

    # Create separate rep & lead/contract -> handlowiec tries GET -> 403
    # Create second rep (handlowiec) under a different manager (i.e. no relation to manager_id of manager_u)
    rnd = datetime.now().strftime("%H%M%S")
    other_rep_email = f"phase18_other_{rnd}@test.com"
    r = requests.post(
        f"{API}/auth/register",
        headers=auth(admin_tok),
        json={
            "email": other_rep_email,
            "password": "test1234",
            "name": "Other Rep Phase18",
            "role": "handlowiec",
            "manager_id": None,  # no manager
        },
        timeout=30,
    )
    _check(r.status_code == 200, f"create other rep: {r.status_code}")
    if r.status_code == 200:
        other_rep_id = r.json()["id"]
        created_user_ids.append(other_rep_id)
        # Login as other_rep
        other_tok, other_u = login(other_rep_email)
        # Create lead assigned to other_rep
        r = requests.post(
            f"{API}/leads",
            headers=auth(admin_tok),
            json={
                "client_name": "Other Klient",
                "address": "ul. Inna 1",
                "building_area": 150.0,
                "building_type": "mieszkalny",
                "status": "nowy",
                "assigned_to": other_rep_id,
            },
            timeout=30,
        )
        assert r.status_code == 200, f"other lead: {r.text}"
        other_lead_id = r.json()["id"]
        created_lead_ids.append(other_lead_id)
        # Create contract on that lead
        r = requests.post(
            f"{API}/contracts",
            headers=auth(admin_tok),
            json={
                "lead_id": other_lead_id,
                "signed_at": datetime.now(timezone.utc).isoformat(),
                "buildings_count": 1,
                "building_type": "mieszkalny",
                "roof_area_m2": 150.0,
                "gross_amount": 90000.0,
                "global_margin": 8000.0,
                "financing_type": "credit",
            },
            timeout=30,
        )
        assert r.status_code == 200, f"other contract: {r.text}"
        other_contract_id = r.json()["id"]
        created_contract_ids.append(other_contract_id)
        # handlowiec@ tries GET -> 403
        r = requests.get(f"{API}/contracts/{other_contract_id}", headers=auth(hand_tok), timeout=30)
        _check(r.status_code == 403, f"GET other contract as hand == 403 (got {r.status_code})")

    # GET nonexistent -> 404
    r = requests.get(f"{API}/contracts/nonexistent-xyz", headers=auth(admin_tok), timeout=30)
    _check(r.status_code == 404, f"GET nonexistent contract == 404 (got {r.status_code})")

    print("\n=== 3) PATCH corrections (admin-only fields) ===")
    # Fetch current values before patching
    r = requests.get(f"{API}/contracts/{contract_id_X}", headers=auth(admin_tok), timeout=30)
    before = r.json()
    orig_global_margin = float(before["global_margin"])
    orig_commission_pct = float(before["commission_percent"])
    orig_commission_amount = float(before["commission_amount"])
    print(f"  orig: global_margin={orig_global_margin} commission_pct={orig_commission_pct} commission_amount={orig_commission_amount}")

    # PATCH admin: additional_costs=2000, note="Test wymiana więźby"
    r = requests.patch(
        f"{API}/contracts/{contract_id_X}",
        headers=auth(admin_tok),
        json={"additional_costs": 2000, "additional_costs_note": "Test wymiana więźby"},
        timeout=30,
    )
    _check(r.status_code == 200, f"PATCH additional_costs admin == 200 (got {r.status_code})")
    if r.status_code == 200:
        body = r.json()
        _check(body.get("additional_costs") == 2000, f"additional_costs == 2000 (got {body.get('additional_costs')})")
        _check(body.get("additional_costs_note") == "Test wymiana więźby", f"additional_costs_note match (got {body.get('additional_costs_note')})")
        expected_effective = round(orig_global_margin - 2000, 2)
        _check(
            abs(float(body.get("effective_margin") or 0) - expected_effective) < 0.01,
            f"effective_margin == {expected_effective} (got {body.get('effective_margin')})",
        )
        expected_ct = round(orig_commission_pct / 100 * expected_effective, 2)
        _check(
            abs(float(body.get("commission_total") or 0) - expected_ct) < 0.01,
            f"commission_total == {expected_ct} (got {body.get('commission_total')})",
        )
        _check(
            abs(float(body.get("commission_total_original") or 0) - orig_commission_amount) < 0.01,
            f"commission_total_original unchanged == {orig_commission_amount} (got {body.get('commission_total_original')})",
        )

    # PATCH as manager -> 403
    r = requests.patch(
        f"{API}/contracts/{contract_id_X}",
        headers=auth(mgr_tok),
        json={"additional_costs": 500},
        timeout=30,
    )
    _check(r.status_code == 403, f"PATCH additional_costs as manager == 403 (got {r.status_code})")

    # PATCH as handlowiec -> 403 (require_roles("admin","manager") blocks handlowiec at 403)
    r = requests.patch(
        f"{API}/contracts/{contract_id_X}",
        headers=auth(hand_tok),
        json={"additional_costs": 500},
        timeout=30,
    )
    _check(r.status_code == 403, f"PATCH additional_costs as hand == 403 (got {r.status_code})")

    # PATCH admin negative -> 400
    r = requests.patch(
        f"{API}/contracts/{contract_id_X}",
        headers=auth(admin_tok),
        json={"additional_costs": -100},
        timeout=30,
    )
    _check(r.status_code == 400, f"PATCH additional_costs=-100 admin == 400 (got {r.status_code})")

    # Clear corrections
    r = requests.patch(
        f"{API}/contracts/{contract_id_X}",
        headers=auth(admin_tok),
        json={"additional_costs": 0, "additional_costs_note": ""},
        timeout=30,
    )
    _check(r.status_code == 200, f"PATCH clear corrections == 200 (got {r.status_code})")
    if r.status_code == 200:
        body = r.json()
        _check(float(body.get("additional_costs") or 0) == 0, "additional_costs cleared to 0")
        _check(body.get("additional_costs_note") == "", f"additional_costs_note cleared (got {body.get('additional_costs_note')!r})")
        _check(
            abs(float(body.get("commission_total") or 0) - orig_commission_amount) < 0.01,
            f"commission_total back to original {orig_commission_amount} (got {body.get('commission_total')})",
        )

    print("\n=== 4) PATCH payment (cash contracts) ===")
    # Find cash contract (or create)
    r = requests.get(f"{API}/contracts", headers=auth(admin_tok), timeout=30)
    all_contracts = r.json()
    cash_contract = None
    for c in all_contracts:
        if c.get("financing_type") == "cash" and not c.get("cancelled"):
            cash_contract = c
            break
    if not cash_contract:
        # Create one using handlowiec's lead (or reuse contract_for_hand's lead). To avoid conflict, create a new lead
        r = requests.post(
            f"{API}/leads",
            headers=auth(admin_tok),
            json={
                "client_name": "Cash Klient Phase18",
                "address": "ul. Gotówka 1",
                "building_area": 160.0,
                "building_type": "mieszkalny",
                "status": "nowy",
                "assigned_to": hand_u["id"],
            },
            timeout=30,
        )
        assert r.status_code == 200
        cash_lead_id = r.json()["id"]
        created_lead_ids.append(cash_lead_id)
        r = requests.post(
            f"{API}/contracts",
            headers=auth(admin_tok),
            json={
                "lead_id": cash_lead_id,
                "signed_at": datetime.now(timezone.utc).isoformat(),
                "buildings_count": 1,
                "building_type": "mieszkalny",
                "roof_area_m2": 160.0,
                "gross_amount": 100000.0,
                "global_margin": 10000.0,
                "financing_type": "cash",
                "down_payment_amount": 20000.0,
                "installments_count": 12,
                "total_paid_amount": 20000.0,
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        cash_contract = r.json()
        created_contract_ids.append(cash_contract["id"])

    cash_cid = cash_contract["id"]
    print(f"  cash contract id = {cash_cid} rep_id={cash_contract.get('rep_id')}")

    # PATCH admin total_paid=some value
    r = requests.patch(
        f"{API}/contracts/{cash_cid}",
        headers=auth(admin_tok),
        json={"total_paid_amount": 35000.0},
        timeout=30,
    )
    _check(r.status_code == 200, f"PATCH total_paid admin == 200 (got {r.status_code})")

    # PATCH as manager - only if manager owns or rep_id is under them
    # cash_contract rep_id may be handlowiec_u (under manager) - if yes, manager can edit
    cash_rep_id = cash_contract.get("rep_id")
    is_under_mgr = False
    r_hand_user = requests.get(f"{API}/users", headers=auth(mgr_tok), timeout=30)
    if r_hand_user.status_code == 200:
        for u in r_hand_user.json():
            if u.get("id") == cash_rep_id:
                is_under_mgr = True
                break

    r = requests.patch(
        f"{API}/contracts/{cash_cid}",
        headers=auth(mgr_tok),
        json={"total_paid_amount": 40000.0},
        timeout=30,
    )
    if is_under_mgr:
        _check(r.status_code == 200, f"PATCH total_paid as manager (own team) == 200 (got {r.status_code})")
    else:
        _check(r.status_code == 403, f"PATCH total_paid as manager (not own) == 403 (got {r.status_code})")

    # PATCH as handlowiec -> 403 (require_roles("admin","manager") blocks)
    r = requests.patch(
        f"{API}/contracts/{cash_cid}",
        headers=auth(hand_tok),
        json={"total_paid_amount": 45000.0},
        timeout=30,
    )
    _check(r.status_code == 403, f"PATCH total_paid as hand == 403 (got {r.status_code})")

    print("\n=== 5) Dynamic recompute with corrections + 14d logic ===")
    # Create contract signed 20d ago, gm=10000, pct=50, credit → payable, released=5000
    # Need lead first. Create lead assigned to handlowiec.
    r = requests.post(
        f"{API}/leads",
        headers=auth(admin_tok),
        json={
            "client_name": "Dynamic Phase18",
            "address": "ul. Testowa 2",
            "building_area": 170.0,
            "building_type": "mieszkalny",
            "status": "nowy",
            "assigned_to": hand_u["id"],
        },
        timeout=30,
    )
    assert r.status_code == 200
    dyn_lead_id = r.json()["id"]
    created_lead_ids.append(dyn_lead_id)
    signed_at_20d = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    r = requests.post(
        f"{API}/contracts",
        headers=auth(admin_tok),
        json={
            "lead_id": dyn_lead_id,
            "signed_at": signed_at_20d,
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 170.0,
            "gross_amount": 150000.0,
            "global_margin": 10000.0,
            "financing_type": "credit",
            "commission_percent_override": 50.0,
        },
        timeout=30,
    )
    _check(r.status_code == 200, f"create dynamic contract == 200 (got {r.status_code}: {r.text[:200]})")
    dyn_c = r.json()
    dyn_cid = dyn_c["id"]
    created_contract_ids.append(dyn_cid)
    _check(dyn_c.get("status") == "payable", f"dynamic status=payable (got {dyn_c.get('status')})")
    _check(
        abs(float(dyn_c.get("commission_released") or 0) - 5000.0) < 0.01,
        f"dynamic commission_released=5000 (got {dyn_c.get('commission_released')})",
    )

    # PATCH additional_costs=4000 -> commission_total=3000, released=3000, original=5000
    r = requests.patch(
        f"{API}/contracts/{dyn_cid}",
        headers=auth(admin_tok),
        json={"additional_costs": 4000},
        timeout=30,
    )
    _check(r.status_code == 200, f"PATCH dyn additional_costs=4000 == 200 (got {r.status_code})")
    body = r.json()
    _check(
        abs(float(body.get("commission_total") or 0) - 3000.0) < 0.01,
        f"dyn commission_total=3000 (got {body.get('commission_total')})",
    )
    _check(
        abs(float(body.get("commission_released") or 0) - 3000.0) < 0.01,
        f"dyn commission_released=3000 (got {body.get('commission_released')})",
    )
    _check(
        abs(float(body.get("commission_total_original") or 0) - 5000.0) < 0.01,
        f"dyn commission_total_original=5000 (got {body.get('commission_total_original')})",
    )

    # Revert: additional_costs=0
    r = requests.patch(
        f"{API}/contracts/{dyn_cid}",
        headers=auth(admin_tok),
        json={"additional_costs": 0},
        timeout=30,
    )
    _check(r.status_code == 200, f"PATCH revert additional_costs=0 == 200 (got {r.status_code})")
    body = r.json()
    _check(
        abs(float(body.get("commission_released") or 0) - 5000.0) < 0.01,
        f"dyn revert: commission_released back to 5000 (got {body.get('commission_released')})",
    )

    print("\n=== 6) Finance v2 reflects corrections ===")
    # Apply a correction on dyn_cid then fetch finance-v2 as admin
    r = requests.patch(
        f"{API}/contracts/{dyn_cid}",
        headers=auth(admin_tok),
        json={"additional_costs": 2500, "additional_costs_note": "test finance v2"},
        timeout=30,
    )
    _check(r.status_code == 200, "re-apply correction for finance-v2 check == 200")
    r = requests.get(f"{API}/dashboard/finance-v2", headers=auth(admin_tok), timeout=30)
    _check(r.status_code == 200, f"GET /dashboard/finance-v2 == 200 (got {r.status_code})")
    if r.status_code == 200:
        fv2 = r.json()
        all_entries = fv2.get("contracts_all", [])
        hit = next((x for x in all_entries if x.get("id") == dyn_cid), None)
        _check(hit is not None, "corrected contract present in finance-v2 contracts_all")
        if hit:
            # commission_total should be 50% * (10000-2500) = 3750
            _check(
                abs(float(hit.get("commission_total") or 0) - 3750.0) < 0.01,
                f"finance-v2 contract commission_total reduced to 3750 (got {hit.get('commission_total')})",
            )
            _check(
                abs(float(hit.get("additional_costs") or 0) - 2500.0) < 0.01,
                f"finance-v2 contract additional_costs=2500 (got {hit.get('additional_costs')})",
            )

    print("\n=== 7) Cleanup ===")
    # Delete created contracts
    for cid in created_contract_ids:
        r = requests.delete(f"{API}/contracts/{cid}", headers=auth(admin_tok), timeout=30)
        print(f"  delete contract {cid}: {r.status_code}")
    # Delete created leads
    for lid in created_lead_ids:
        r = requests.delete(f"{API}/leads/{lid}", headers=auth(admin_tok), timeout=30)
        print(f"  delete lead {lid}: {r.status_code}")
    # Delete created users
    for uid in created_user_ids:
        r = requests.delete(f"{API}/users/{uid}", headers=auth(admin_tok), timeout=30)
        print(f"  delete user {uid}: {r.status_code}")

    print("\n=== RESULTS ===")
    print(f"  PASSED: {PASSED}")
    print(f"  FAILED: {FAILED}")
    if ERRORS:
        print("\nFAILURES:")
        for e in ERRORS:
            print(f"  - {e}")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
