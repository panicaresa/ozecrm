"""Finance dashboard backend tests - Phase 1.6"""
import os
import sys
import json
import requests
from typing import Dict, Any, List, Optional, Tuple

BACKEND_URL = "https://renewable-sales-hub.preview.emergentagent.com"
API = BACKEND_URL + "/api"

ADMIN = ("admin@test.com", "test1234")
MANAGER = ("manager@test.com", "test1234")
HANDLOWIEC = ("handlowiec@test.com", "test1234")

results: List[Tuple[str, bool, str]] = []


def log(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} {('- ' + detail) if detail else ''}")
    return ok


def login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def auth(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def approx(a: float, b: float, tol: float = 0.01) -> bool:
    return abs(float(a) - float(b)) <= tol


def main() -> int:
    # ============ 1) AUTH TESTS ============
    r = requests.get(f"{API}/dashboard/finance", timeout=30)
    log("GET /api/dashboard/finance without auth → 401", r.status_code == 401, f"status={r.status_code}")

    admin_tok = login(*ADMIN)
    manager_tok = login(*MANAGER)
    rep_tok = login(*HANDLOWIEC)

    # admin user info
    me_admin = requests.get(f"{API}/auth/me", headers=auth(admin_tok)).json()
    me_manager = requests.get(f"{API}/auth/me", headers=auth(manager_tok)).json()
    me_rep = requests.get(f"{API}/auth/me", headers=auth(rep_tok)).json()
    rep_id = me_rep["id"]
    manager_id = me_manager["id"]
    print(f"  - rep_id={rep_id}  manager_id={manager_id}")

    for who, tok in [("admin", admin_tok), ("manager", manager_tok), ("handlowiec", rep_tok)]:
        r = requests.get(f"{API}/dashboard/finance", headers=auth(tok), timeout=30)
        log(f"GET /api/dashboard/finance as {who} → 200", r.status_code == 200, f"status={r.status_code}")

    admin_fin = requests.get(f"{API}/dashboard/finance", headers=auth(admin_tok)).json()
    manager_fin = requests.get(f"{API}/dashboard/finance", headers=auth(manager_tok)).json()
    rep_fin = requests.get(f"{API}/dashboard/finance", headers=auth(rep_tok)).json()

    # ============ 2) RESPONSE SHAPE ============
    required_top = ["period", "settings_snapshot", "totals_month", "totals_all_time", "by_rep", "contracts_month", "contracts_all"]
    missing = [k for k in required_top if k not in admin_fin]
    log("Response has required top-level keys", not missing, f"missing={missing}")

    p = admin_fin.get("period", {})
    log("period has month_start + month_end strings", isinstance(p.get("month_start"), str) and isinstance(p.get("month_end"), str),
        f"month_start={p.get('month_start')}  month_end={p.get('month_end')}")

    ss = admin_fin.get("settings_snapshot", {})
    ss_keys = ["commission_percent", "margin_per_m2", "base_price_low", "base_price_high"]
    log("settings_snapshot has required keys",
        all(k in ss for k in ss_keys), f"keys={list(ss.keys())}")

    tm = admin_fin.get("totals_month", {})
    tm_keys = ["signed_count", "commission_sum", "margin_sum", "netto_sum", "brutto_sum", "vat_sum"]
    log("totals_month has required numeric keys",
        all(k in tm and isinstance(tm[k], (int, float)) for k in tm_keys),
        f"totals_month={tm}")

    by_rep = admin_fin.get("by_rep", [])
    log("by_rep is array", isinstance(by_rep, list))
    if by_rep:
        br0 = by_rep[0]
        needed = ["rep_id", "rep_name", "signed_count", "commission_sum", "margin_sum", "brutto_sum"]
        log("by_rep[0] has required keys", all(k in br0 for k in needed),
            f"keys={list(br0.keys())}")

    def check_contract_shape(lst: List[Dict[str, Any]], label: str) -> None:
        if not lst:
            print(f"  - {label} empty; skip shape check")
            return
        c = lst[0]
        needed = ["id", "client_name", "area", "building_type", "base_netto", "margin_netto",
                  "total_netto", "vat", "vat_label", "total_brutto", "commission"]
        missing_c = [k for k in needed if k not in c]
        log(f"{label}[0] has all required keys", not missing_c, f"missing={missing_c}")

    check_contract_shape(admin_fin.get("contracts_month", []), "admin.contracts_month")
    check_contract_shape(admin_fin.get("contracts_all", []), "admin.contracts_all")

    # ============ 3) SCOPING BY ROLE ============
    rep_month_ids = {c["id"] for c in rep_fin.get("contracts_month", [])}
    manager_month_ids = {c["id"] for c in manager_fin.get("contracts_month", [])}
    admin_month_ids = {c["id"] for c in admin_fin.get("contracts_month", [])}

    rep_all_ids = {c["id"] for c in rep_fin.get("contracts_all", [])}
    manager_all_ids = {c["id"] for c in manager_fin.get("contracts_all", [])}
    admin_all_ids = {c["id"] for c in admin_fin.get("contracts_all", [])}

    # Handlowiec: all contracts must be assigned_to == rep_id
    rep_assigned_ok = all(c.get("rep_id") == rep_id for c in rep_fin.get("contracts_all", []))
    log("handlowiec only sees leads assigned to them", rep_assigned_ok)

    # Manager contracts_month is superset of H1 (handlowiec)
    log("manager.contracts_month ⊇ handlowiec.contracts_month",
        rep_month_ids.issubset(manager_month_ids),
        f"rep_only-not-in-manager={rep_month_ids - manager_month_ids}")

    # Admin superset of manager's
    log("admin.contracts_month ⊇ manager.contracts_month",
        manager_month_ids.issubset(admin_month_ids),
        f"manager_only-not-in-admin={manager_month_ids - admin_month_ids}")

    log("admin.contracts_all ⊇ manager.contracts_all",
        manager_all_ids.issubset(admin_all_ids))
    log("manager.contracts_all ⊇ handlowiec.contracts_all",
        rep_all_ids.issubset(manager_all_ids))

    # ============ 4) MATH VERIFICATION ============
    # Get settings
    sr = requests.get(f"{API}/settings", headers=auth(admin_tok))
    log("GET /api/settings (admin) → 200", sr.status_code == 200)
    settings = sr.json()
    cp = float(settings["commission_percent"])
    mpm = float(settings["margin_per_m2"])
    bpl = float(settings["base_price_low"])
    bph = float(settings["base_price_high"])
    print(f"  - settings: commission_percent={cp}, margin_per_m2={mpm}, base_low={bpl}, base_high={bph}")

    # Create test leads as handlowiec
    created_lead_ids: List[str] = []

    def create_lead_and_sign(client_name: str, area: float, btype: str) -> str:
        body = {"client_name": client_name, "status": "nowy", "building_area": area, "building_type": btype}
        r = requests.post(f"{API}/leads", json=body, headers=auth(rep_tok), timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"create lead failed: {r.status_code} {r.text}")
        lid = r.json()["id"]
        r2 = requests.patch(f"{API}/leads/{lid}", json={"status": "podpisana"}, headers=auth(rep_tok), timeout=30)
        if r2.status_code != 200:
            raise RuntimeError(f"patch lead failed: {r2.status_code} {r2.text}")
        created_lead_ids.append(lid)
        return lid

    # Case A: mieszkalny 150
    lid_a = create_lead_and_sign("Test Finance 150m2", 150, "mieszkalny")
    # Case B: gospodarczy 180
    lid_b = create_lead_and_sign("Test Finance 180 gosp", 180, "gospodarczy")
    # Case C: mieszkalny 250 (>200 area → base_high, VAT 8%)
    lid_c = create_lead_and_sign("Test Finance 250m2", 250, "mieszkalny")
    # Case D: mieszkalny 400 (mixed VAT)
    lid_d = create_lead_and_sign("Test Finance 400 mix", 400, "mieszkalny")

    # Fetch finance as handlowiec
    fin = requests.get(f"{API}/dashboard/finance", headers=auth(rep_tok)).json()
    contracts = {c["id"]: c for c in fin.get("contracts_month", [])}

    def assert_math(lid: str, exp: Dict[str, Any], label: str) -> None:
        c = contracts.get(lid)
        if not c:
            log(f"math[{label}] contract present", False, f"lead_id={lid} NOT found in contracts_month")
            return
        ok = True
        mismatches = []
        for k, v in exp.items():
            if k == "vat_label":
                if c.get(k) != v:
                    ok = False
                    mismatches.append(f"{k}: got {c.get(k)}, expected {v}")
            else:
                if not approx(c.get(k, 0), v, 0.01):
                    ok = False
                    mismatches.append(f"{k}: got {c.get(k)}, expected {v}")
        log(f"math[{label}] all fields", ok, "; ".join(mismatches) if mismatches else f"id={lid}")

    # A: mieszkalny 150  base=275 (area<=200), margin=50/m2
    assert_math(lid_a, {
        "base_netto": 150 * bpl,
        "margin_netto": 150 * mpm,
        "total_netto": 150 * bpl + 150 * mpm,
        "vat": round((150 * bpl + 150 * mpm) * 0.08, 2),
        "total_brutto": round((150 * bpl + 150 * mpm) * 1.08, 2),
        "commission": (cp / 100.0) * (150 * mpm),
        "vat_label": "8%",
    }, "A-mieszkalny-150")

    # B: gospodarczy 180 VAT 23%
    base_b = 180 * bpl
    mar_b = 180 * mpm
    tn_b = base_b + mar_b
    assert_math(lid_b, {
        "base_netto": base_b,
        "margin_netto": mar_b,
        "total_netto": tn_b,
        "vat": round(tn_b * 0.23, 2),
        "total_brutto": round(tn_b * 1.23, 2),
        "commission": (cp / 100.0) * mar_b,
        "vat_label": "23%",
    }, "B-gospodarczy-180")

    # C: mieszkalny 250 base_high, VAT 8% (<=300)
    base_c = 250 * bph
    mar_c = 250 * mpm
    tn_c = base_c + mar_c
    assert_math(lid_c, {
        "base_netto": base_c,
        "margin_netto": mar_c,
        "total_netto": tn_c,
        "vat": round(tn_c * 0.08, 2),
        "total_brutto": round(tn_c * 1.08, 2),
        "commission": (cp / 100.0) * mar_c,
        "vat_label": "8%",
    }, "C-mieszkalny-250")

    # D: mieszkalny 400 mixed VAT
    base_d = 400 * bph
    mar_d = 400 * mpm
    tn_d = base_d + mar_d
    vat_d = round(tn_d * (300.0 / 400.0) * 0.08 + tn_d * (100.0 / 400.0) * 0.23, 2)
    assert_math(lid_d, {
        "base_netto": base_d,
        "margin_netto": mar_d,
        "total_netto": tn_d,
        "vat": vat_d,
        "total_brutto": round(tn_d + vat_d, 2),
        "commission": (cp / 100.0) * mar_d,
        "vat_label": "Mieszany",
    }, "D-mieszkalny-400")

    # ============ 5) CLEANUP ============
    for lid in created_lead_ids:
        r = requests.delete(f"{API}/leads/{lid}", headers=auth(admin_tok))
        log(f"DELETE lead {lid[:8]}... as admin", r.status_code == 200, f"status={r.status_code}")

    # ============ 6) REGRESSION SANITY ============
    rs = requests.get(f"{API}/settings", headers=auth(admin_tok))
    s = rs.json()
    log("GET /api/settings still returns commission_percent + margin_per_m2 + base_low + base_high",
        all(k in s for k in ["commission_percent", "margin_per_m2", "base_price_low", "base_price_high"]))

    rm = requests.get(f"{API}/dashboard/manager", headers=auth(manager_tok))
    log("GET /api/dashboard/manager (manager) → 200", rm.status_code == 200, f"status={rm.status_code}")

    rr = requests.get(f"{API}/dashboard/rep", headers=auth(rep_tok))
    log("GET /api/dashboard/rep (handlowiec) → 200", rr.status_code == 200, f"status={rr.status_code}")

    # SUMMARY
    fails = [r for r in results if not r[1]]
    print("\n" + "=" * 60)
    print(f"TOTAL: {len(results)} tests, PASS={len(results)-len(fails)}, FAIL={len(fails)}")
    if fails:
        print("\nFAILURES:")
        for name, _, detail in fails:
            print(f"  - {name}: {detail}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
