"""
Phase 1.7 backend tests — Contracts + Calendar + Finance v2.
Runs against the public backend URL defined in frontend/.env (EXPO_PUBLIC_BACKEND_URL).
"""
import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = os.environ.get("BACKEND_URL") or "https://renewable-sales-hub.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

failures = []
passes = []


def check(cond, label, ctx=None):
    if cond:
        passes.append(label)
        print(f"  [{PASS}] {label}")
    else:
        failures.append((label, ctx))
        print(f"  [{FAIL}] {label}  ctx={ctx}")


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


def main():
    print(f"BASE: {API}")

    # Login all roles
    admin_tok, admin_u = login("admin@test.com", "test1234")
    manager_tok, manager_u = login("manager@test.com", "test1234")
    rep_tok, rep_u = login("handlowiec@test.com", "test1234")
    print(f"admin_id={admin_u['id']} manager_id={manager_u['id']} rep_id={rep_u['id']}")

    # --- Section 1: Lead meeting_at persistence ---
    print("\n[1] Lead meeting_at persistence")
    r = requests.post(f"{API}/leads", json={"client_name": "Calendar Test"}, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST /api/leads (Calendar Test) → 200", r.text[:200])
    lead_cal = r.json()
    lead_cal_id = lead_cal["id"]
    check(lead_cal.get("assigned_to") == rep_u["id"], "Calendar Test lead assigned to handlowiec")

    r = requests.patch(f"{API}/leads/{lead_cal_id}", json={"meeting_at": "2099-06-15T10:30:00Z", "status": "umowione"},
                       headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "PATCH meeting_at + status=umowione → 200", r.text[:200])
    body = r.json()
    check(body.get("meeting_at") is not None, "meeting_at present in response")
    check(body.get("status") == "umowione", "status set to umowione")

    # Clear
    r = requests.patch(f"{API}/leads/{lead_cal_id}", json={"meeting_at": None}, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "PATCH meeting_at=null → 200")
    body = r.json()
    # NOTE: server ignores None values due to `if v is not None` filter. So clearing via null may not work.
    if body.get("meeting_at") is not None:
        check(False, "meeting_at cleared via null PATCH",
              f"BUG: server filters out None values in update_lead (cannot clear meeting_at). Got {body.get('meeting_at')}")
    else:
        check(True, "meeting_at cleared via null PATCH")

    # Re-set
    r = requests.patch(f"{API}/leads/{lead_cal_id}", json={"meeting_at": "2099-06-15T10:30:00Z"},
                       headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "PATCH reset meeting_at → 200")
    check(r.json().get("meeting_at") is not None, "meeting_at present again")

    # --- Section 2: Calendar ---
    print("\n[2] Calendar endpoint")
    r = requests.get(f"{API}/calendar/meetings", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/calendar/meetings as handlowiec → 200")
    cal_rep = r.json()
    check(isinstance(cal_rep, list), "rep cal is list")
    rep_ids = [m["lead_id"] for m in cal_rep]
    check(lead_cal_id in rep_ids, "Calendar Test lead present for rep")

    r = requests.get(f"{API}/calendar/meetings", headers=auth_h(manager_tok), timeout=30)
    check(r.status_code == 200, "GET /api/calendar/meetings as manager → 200")
    cal_mgr = r.json()
    mgr_ids = {m["lead_id"] for m in cal_mgr}
    check(lead_cal_id in mgr_ids, "Calendar Test lead present for manager (superset)")
    check(set(rep_ids).issubset(mgr_ids), "manager calendar ⊇ rep calendar")

    r = requests.get(f"{API}/calendar/meetings", headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "GET /api/calendar/meetings as admin → 200")
    cal_adm = r.json()
    adm_ids = {m["lead_id"] for m in cal_adm}
    check(lead_cal_id in adm_ids, "Calendar Test lead present for admin")
    check(mgr_ids.issubset(adm_ids), "admin calendar ⊇ manager calendar")

    r = requests.get(f"{API}/calendar/meetings", timeout=30)
    check(r.status_code == 401, "GET /api/calendar/meetings without auth → 401")

    # Cleanup calendar lead now
    r = requests.delete(f"{API}/leads/{lead_cal_id}", headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "DELETE Calendar Test lead as admin → 200")

    # --- Section 3: Contracts auth gates ---
    print("\n[3] Contracts auth gates")
    r = requests.post(f"{API}/contracts", json={}, timeout=30)
    check(r.status_code in (401, 422), "POST /api/contracts no auth → 401 (or 422)")
    # Prefer explicit 401 (body may still trigger 401 first due to Depends ordering). FastAPI runs deps before validation so 401 expected.
    check(r.status_code == 401, "POST /api/contracts no auth → 401 strict")

    r = requests.get(f"{API}/contracts", timeout=30)
    check(r.status_code == 401, "GET /api/contracts no auth → 401")

    r = requests.patch(f"{API}/contracts/nonexistent", json={"note": "x"}, timeout=30)
    check(r.status_code == 401, "PATCH /api/contracts/{id} no auth → 401")

    r = requests.delete(f"{API}/contracts/nonexistent", timeout=30)
    check(r.status_code == 401, "DELETE /api/contracts/{id} no auth → 401")

    r = requests.patch(f"{API}/contracts/anyid", json={"note": "x"}, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 403, "PATCH /api/contracts/{id} as handlowiec → 403")

    r = requests.delete(f"{API}/contracts/anyid", headers=auth_h(manager_tok), timeout=30)
    check(r.status_code == 403, "DELETE /api/contracts/{id} as manager → 403")

    # --- Section 4: Contract creation math ---
    print("\n[4] Contract creation math")
    r = requests.get(f"{API}/settings", headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "GET /api/settings → 200")
    settings = r.json()
    commission_percent = float(settings.get("commission_percent") or 50.0)
    print(f"  Current commission_percent={commission_percent}")

    # Create lead_A
    r = requests.post(f"{API}/leads", json={
        "client_name": "Contract Credit 150m2",
        "status": "decyzja",
        "building_area": 150,
        "building_type": "mieszkalny",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST lead_A → 200", r.text[:200])
    lead_A = r.json()
    lead_A_id = lead_A["id"]

    today_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    r = requests.post(f"{API}/contracts", json={
        "lead_id": lead_A_id,
        "signed_at": today_iso,
        "buildings_count": 1,
        "building_type": "mieszkalny",
        "roof_area_m2": 150,
        "gross_amount": 65000,
        "global_margin": 12000,
        "financing_type": "credit",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST contract A (credit, today) → 200", r.text[:300])
    contract_A = r.json()
    id_A = contract_A["id"]
    expected_commission = round(commission_percent / 100.0 * 12000, 2)

    check(abs(contract_A.get("commission_percent", 0) - commission_percent) < 0.01,
          f"contract_A.commission_percent == {commission_percent}", contract_A.get("commission_percent"))
    check(abs(contract_A.get("commission_amount", 0) - expected_commission) < 0.01,
          f"contract_A.commission_amount == {expected_commission}", contract_A.get("commission_amount"))
    check(contract_A.get("status") == "frozen", f"contract_A.status == 'frozen'", contract_A.get("status"))
    check(abs(contract_A.get("commission_frozen", 0) - expected_commission) < 0.01,
          f"contract_A.commission_frozen == {expected_commission}", contract_A.get("commission_frozen"))
    check(abs(contract_A.get("commission_released", -1) - 0.0) < 0.01,
          "contract_A.commission_released == 0.0", contract_A.get("commission_released"))
    days_A = contract_A.get("days_until_release")
    check(days_A in (13, 14), f"contract_A.days_until_release in (13,14): got {days_A}", days_A)

    # Verify lead_A is now "podpisana"
    r = requests.get(f"{API}/leads", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET leads after contract creation → 200")
    leads = r.json()
    lead_A_refreshed = next((l for l in leads if l["id"] == lead_A_id), None)
    check(lead_A_refreshed is not None, "lead_A found after contract creation")
    if lead_A_refreshed:
        check(lead_A_refreshed.get("status") == "podpisana",
              "lead_A.status flipped to 'podpisana'", lead_A_refreshed.get("status"))

    # --- Section 5: Dynamic status (credit, past 15d) ---
    print("\n[5] Dynamic status — signed_at 15 days ago (credit)")
    r = requests.post(f"{API}/leads", json={
        "client_name": "Contract Credit PAST",
        "status": "decyzja",
        "building_area": 100,
        "building_type": "mieszkalny",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST lead_B → 200", r.text[:200])
    lead_B_id = r.json()["id"]
    past_iso = (datetime.now(timezone.utc) - timedelta(days=15)).replace(microsecond=0).isoformat()

    r = requests.post(f"{API}/contracts", json={
        "lead_id": lead_B_id,
        "signed_at": past_iso,
        "building_type": "mieszkalny",
        "roof_area_m2": 100,
        "gross_amount": 40000,
        "global_margin": 8000,
        "financing_type": "credit",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST contract B (credit, -15d) → 200", r.text[:300])
    contract_B = r.json()
    id_B = contract_B["id"]
    expected_B = round(commission_percent / 100.0 * 8000, 2)
    check(contract_B.get("status") == "payable", f"contract_B.status == 'payable'", contract_B.get("status"))
    check(abs(contract_B.get("commission_released", 0) - expected_B) < 0.01,
          f"contract_B.commission_released == {expected_B}", contract_B.get("commission_released"))
    check(abs(contract_B.get("commission_frozen", -1) - 0.0) < 0.01,
          "contract_B.commission_frozen == 0", contract_B.get("commission_frozen"))

    # --- Section 6: Cash contract partial ---
    print("\n[6] Cash contract partial release")
    r = requests.post(f"{API}/leads", json={
        "client_name": "Contract Cash",
        "status": "decyzja",
        "building_area": 200,
        "building_type": "gospodarczy",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST lead_C → 200", r.text[:200])
    lead_C_id = r.json()["id"]

    r = requests.post(f"{API}/contracts", json={
        "lead_id": lead_C_id,
        "signed_at": past_iso,
        "building_type": "gospodarczy",
        "roof_area_m2": 200,
        "gross_amount": 100000,
        "global_margin": 20000,
        "financing_type": "cash",
        "down_payment_amount": 50000,
        "installments_count": 2,
        "total_paid_amount": 50000,
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST contract C (cash, -15d, 50% paid) → 200", r.text[:300])
    contract_C = r.json()
    id_C = contract_C["id"]
    expected_C_total = round(commission_percent / 100.0 * 20000, 2)
    expected_C_released = round(expected_C_total * 0.5, 2)
    expected_C_frozen = round(expected_C_total - expected_C_released, 2)
    check(contract_C.get("status") == "partial", f"contract_C.status == 'partial'", contract_C.get("status"))
    check(abs(contract_C.get("paid_pct", 0) - 50.0) < 0.1, "contract_C.paid_pct == 50.0", contract_C.get("paid_pct"))
    check(abs(contract_C.get("commission_total", 0) - expected_C_total) < 0.01,
          f"contract_C.commission_total == {expected_C_total}", contract_C.get("commission_total"))
    check(abs(contract_C.get("commission_released", 0) - expected_C_released) < 0.01,
          f"contract_C.commission_released == {expected_C_released}", contract_C.get("commission_released"))
    check(abs(contract_C.get("commission_frozen", 0) - expected_C_frozen) < 0.01,
          f"contract_C.commission_frozen == {expected_C_frozen}", contract_C.get("commission_frozen"))

    # PATCH as admin to 100%
    r = requests.patch(f"{API}/contracts/{id_C}", json={"total_paid_amount": 100000}, headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "PATCH contract C total_paid=100000 as admin → 200", r.text[:300])
    cC2 = r.json()
    check(cC2.get("status") == "payable", f"after PATCH C.status == 'payable'", cC2.get("status"))
    check(abs(cC2.get("paid_pct", 0) - 100.0) < 0.1, "C.paid_pct == 100.0", cC2.get("paid_pct"))
    check(abs(cC2.get("commission_released", 0) - expected_C_total) < 0.01,
          f"C.commission_released == {expected_C_total}", cC2.get("commission_released"))
    check(abs(cC2.get("commission_frozen", -1) - 0.0) < 0.01,
          "C.commission_frozen == 0", cC2.get("commission_frozen"))

    # --- Section 7: Cash fresh (within 14d) → frozen ---
    print("\n[7] Cash fresh (within 14d) still frozen")
    r = requests.post(f"{API}/leads", json={
        "client_name": "Contract Cash Fresh",
        "status": "decyzja",
        "building_area": 150,
        "building_type": "mieszkalny",
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST lead_D → 200", r.text[:200])
    lead_D_id = r.json()["id"]

    r = requests.post(f"{API}/contracts", json={
        "lead_id": lead_D_id,
        "signed_at": today_iso,
        "building_type": "mieszkalny",
        "roof_area_m2": 150,
        "gross_amount": 50000,
        "global_margin": 10000,
        "financing_type": "cash",
        "down_payment_amount": 25000,
        "installments_count": 2,
        "total_paid_amount": 25000,
    }, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST contract D (cash, today, 50% paid) → 200", r.text[:300])
    contract_D = r.json()
    id_D = contract_D["id"]
    check(contract_D.get("status") == "frozen",
          "contract_D.status == 'frozen' (within 14d despite 50% paid)", contract_D.get("status"))

    # --- Section 8: Cancel contract A ---
    print("\n[8] Cancel contract A")
    r = requests.patch(f"{API}/contracts/{id_A}", json={"cancelled": True}, headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "PATCH cancelled=true on contract_A (admin) → 200", r.text[:300])
    cA2 = r.json()
    check(cA2.get("status") == "cancelled", "contract_A.status == 'cancelled'", cA2.get("status"))
    check(abs(cA2.get("commission_released", -1) - 0.0) < 0.01, "A.commission_released==0", cA2.get("commission_released"))
    check(abs(cA2.get("commission_frozen", -1) - 0.0) < 0.01, "A.commission_frozen==0", cA2.get("commission_frozen"))

    # --- Section 9: Role scoping for /api/contracts GET ---
    print("\n[9] Contracts GET role scoping")
    r = requests.get(f"{API}/contracts", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/contracts as rep → 200")
    rep_contracts = r.json()
    rep_contract_ids = {c["id"] for c in rep_contracts}
    for cid, label in [(id_A, "id_A"), (id_B, "id_B"), (id_C, "id_C"), (id_D, "id_D")]:
        check(cid in rep_contract_ids, f"rep sees {label}")
    # verify rep only sees own
    for c in rep_contracts:
        if c.get("rep_id") and c["rep_id"] != rep_u["id"]:
            check(False, f"rep unexpectedly sees other rep's contract {c['id']}", c.get("rep_id"))
            break

    r = requests.get(f"{API}/contracts", headers=auth_h(manager_tok), timeout=30)
    check(r.status_code == 200, "GET /api/contracts as manager → 200")
    mgr_contract_ids = {c["id"] for c in r.json()}
    check(rep_contract_ids.issubset(mgr_contract_ids), "manager contracts ⊇ rep contracts")

    r = requests.get(f"{API}/contracts", headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "GET /api/contracts as admin → 200")
    adm_contract_ids = {c["id"] for c in r.json()}
    check(mgr_contract_ids.issubset(adm_contract_ids), "admin contracts ⊇ manager contracts")

    # --- Section 10: Finance v2 ---
    print("\n[10] /api/dashboard/finance-v2")
    r = requests.get(f"{API}/dashboard/finance-v2", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/dashboard/finance-v2 as rep → 200", r.text[:300])
    fin_rep = r.json()
    payable_ids = {c["id"] for c in fin_rep.get("payable_contracts", [])}
    frozen_ids = {c["id"] for c in fin_rep.get("frozen_contracts", [])}
    partial_ids = {c["id"] for c in fin_rep.get("partial_contracts", [])}
    check(id_B in payable_ids, "finance_v2(rep).payable contains id_B")
    check(id_C in payable_ids, "finance_v2(rep).payable contains id_C (patched to 100%)")
    check(id_D in frozen_ids, "finance_v2(rep).frozen contains id_D (within 14d)")
    check(id_A not in payable_ids and id_A not in frozen_ids and id_A not in partial_ids,
          "finance_v2(rep): cancelled id_A not in any bucket")
    tm = fin_rep.get("totals_month", {})
    check((tm.get("commission_payable_sum") or 0) > 0, "totals_month.commission_payable_sum > 0", tm.get("commission_payable_sum"))
    check((tm.get("commission_frozen_sum") or 0) > 0, "totals_month.commission_frozen_sum > 0", tm.get("commission_frozen_sum"))

    contracts_month_ids = {c["id"] for c in fin_rep.get("contracts_month", [])}
    # lead_A (signed today, cancelled) still in month list? Yes, month list is by signed_at.
    # lead_B signed 15 days ago - may be prior month or current month depending on date
    check(id_A in contracts_month_ids, "contracts_month contains id_A (signed today)")
    check(id_D in contracts_month_ids, "contracts_month contains id_D (signed today)")

    by_rep_map = {r["rep_id"]: r for r in fin_rep.get("by_rep", [])}
    rep_row = by_rep_map.get(rep_u["id"])
    check(rep_row is not None, "by_rep has handlowiec row")
    if rep_row:
        # signed_count should be >= contracts signed this month owned by rep
        # Expected: contracts signed in current month for this rep from our created set.
        this_month_our_ids = {id_A, id_D}  # signed today
        now_dt = datetime.now(timezone.utc)
        past_dt = now_dt - timedelta(days=15)
        if past_dt.month == now_dt.month and past_dt.year == now_dt.year:
            this_month_our_ids |= {id_B, id_C}
        check(rep_row["signed_count"] >= len(this_month_our_ids),
              f"by_rep[rep].signed_count >= {len(this_month_our_ids)}", rep_row["signed_count"])

    # manager superset
    r = requests.get(f"{API}/dashboard/finance-v2", headers=auth_h(manager_tok), timeout=30)
    check(r.status_code == 200, "GET finance-v2 as manager → 200")
    fin_mgr = r.json()
    mgr_all_ids = {c["id"] for c in fin_mgr.get("contracts_all", [])}
    rep_all_ids = {c["id"] for c in fin_rep.get("contracts_all", [])}
    check(rep_all_ids.issubset(mgr_all_ids), "manager contracts_all ⊇ rep contracts_all")

    r = requests.get(f"{API}/dashboard/finance-v2", headers=auth_h(admin_tok), timeout=30)
    check(r.status_code == 200, "GET finance-v2 as admin → 200")
    fin_adm = r.json()
    adm_all_ids = {c["id"] for c in fin_adm.get("contracts_all", [])}
    check(mgr_all_ids.issubset(adm_all_ids), "admin contracts_all ⊇ manager contracts_all")

    # Unauthenticated 401
    r = requests.get(f"{API}/dashboard/finance-v2", timeout=30)
    check(r.status_code == 401, "GET /api/dashboard/finance-v2 no auth → 401")

    # --- Section 11: Cleanup ---
    print("\n[11] Cleanup")
    for cid in [id_A, id_B, id_C, id_D]:
        r = requests.delete(f"{API}/contracts/{cid}", headers=auth_h(admin_tok), timeout=30)
        check(r.status_code == 200, f"DELETE contract {cid[:8]} (admin) → 200", r.text[:200])
    for lid in [lead_A_id, lead_B_id, lead_C_id, lead_D_id]:
        r = requests.delete(f"{API}/leads/{lid}", headers=auth_h(admin_tok), timeout=30)
        check(r.status_code == 200, f"DELETE lead {lid[:8]} (admin) → 200", r.text[:200])

    # --- Section 12: Regression ---
    print("\n[12] Regression sanity")
    for email in ["admin@test.com", "manager@test.com", "handlowiec@test.com"]:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "test1234"}, timeout=30)
        check(r.status_code == 200, f"login {email} → 200")

    for label, tok in [("admin", admin_tok), ("manager", manager_tok), ("rep", rep_tok)]:
        r = requests.get(f"{API}/settings", headers=auth_h(tok), timeout=30)
        check(r.status_code == 200, f"GET /api/settings as {label} → 200")

    r = requests.get(f"{API}/dashboard/manager", headers=auth_h(manager_tok), timeout=30)
    check(r.status_code == 200, "GET /api/dashboard/manager as manager → 200")

    r = requests.get(f"{API}/dashboard/rep", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/dashboard/rep as handlowiec → 200")

    r = requests.get(f"{API}/dashboard/finance", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/dashboard/finance (legacy) as handlowiec → 200")

    r = requests.get(f"{API}/leads", headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "GET /api/leads as handlowiec → 200")

    r = requests.post(f"{API}/leads", json={"client_name": "Regression Temp"}, headers=auth_h(rep_tok), timeout=30)
    check(r.status_code == 200, "POST /api/leads as handlowiec → 200")
    temp_id = r.json()["id"]
    requests.delete(f"{API}/leads/{temp_id}", headers=auth_h(admin_tok), timeout=30)

    print("\n" + "=" * 70)
    print(f"TOTAL: {len(passes)} PASS, {len(failures)} FAIL")
    if failures:
        print("\nFAILURES:")
        for label, ctx in failures:
            print(f"  - {label} :: {ctx}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
