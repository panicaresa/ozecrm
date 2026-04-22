"""
Phase 1.9 — Security & Integrity hardening backend tests.
Covers: K1 (signed_at), W2 (commission override), K5 (cross-field), K6 (idempotency),
        W3 (meeting_at), W9 (contract_audit_log), plus light regression.
"""
import os
import sys
import json
import uuid
import time
from datetime import datetime, timezone, timedelta

import requests

BASE = "https://renewable-sales-hub.preview.emergentagent.com/api"

ADMIN = {"email": "admin@test.com", "password": "test1234"}
MANAGER = {"email": "manager@test.com", "password": "test1234"}
HANDLOWIEC = {"email": "handlowiec@test.com", "password": "test1234"}

PASS = []
FAIL = []


def check(cond, msg, extra=""):
    if cond:
        PASS.append(msg)
        print(f"  ✅ {msg}")
    else:
        FAIL.append(f"{msg} :: {extra}")
        print(f"  ❌ {msg}   {extra}")


def login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def hdr(tok, extra=None):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def create_lead(tok, client_name="K1 Audit Test"):
    r = requests.post(
        f"{BASE}/leads",
        headers=hdr(tok),
        json={
            "client_name": client_name,
            "status": "decyzja",
            "building_area": 150,
            "building_type": "mieszkalny",
        },
        timeout=20,
    )
    assert r.status_code == 200, f"create_lead failed: {r.status_code} {r.text}"
    return r.json()["id"]


def base_contract_body(lead_id, **kw):
    body = {
        "lead_id": lead_id,
        "signed_at": iso(datetime.now(timezone.utc)),
        "buildings_count": 1,
        "building_type": "mieszkalny",
        "roof_area_m2": 150,
        "gross_amount": 50000,
        "global_margin": 10000,
        "financing_type": "credit",
    }
    body.update(kw)
    return body


def post_contract(tok, body, headers_extra=None):
    return requests.post(f"{BASE}/contracts", headers=hdr(tok, headers_extra), json=body, timeout=20)


def admin_delete_contract(atok, cid):
    requests.delete(f"{BASE}/contracts/{cid}", headers=hdr(atok), timeout=10)


def admin_delete_lead(atok, lid):
    requests.delete(f"{BASE}/leads/{lid}", headers=hdr(atok), timeout=10)


def main():
    print("=" * 80)
    print("Phase 1.9 — Security & Integrity hardening tests")
    print("=" * 80)

    # Login
    admin_tok = login(ADMIN)
    manager_tok = login(MANAGER)
    rep_tok = login(HANDLOWIEC)
    check(True, "Login admin/manager/handlowiec succeeded")

    # Rep info
    me = requests.get(f"{BASE}/auth/me", headers=hdr(rep_tok)).json()
    rep_id = me["id"]

    created_contracts = []
    created_leads = []

    # ======================================================================
    # K1: signed_at validation
    # ======================================================================
    print("\n--- K1: signed_at validation ---")
    lead_id = create_lead(rep_tok, "K1 Rep Lead")
    created_leads.append(lead_id)
    now_utc = datetime.now(timezone.utc)

    # a) today
    r = post_contract(rep_tok, base_contract_body(lead_id, signed_at=iso(now_utc)))
    check(r.status_code == 200, "K1a handlowiec signed_at=today → 200", f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # b) yesterday — need fresh lead since status is flipped to podpisana
    lead_id_b = create_lead(rep_tok, "K1b")
    created_leads.append(lead_id_b)
    r = post_contract(rep_tok, base_contract_body(lead_id_b, signed_at=iso(now_utc - timedelta(days=1))))
    check(r.status_code == 200, "K1b handlowiec signed_at=yesterday → 200", f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # c) 3 days ago → 400
    lead_id_c = create_lead(rep_tok, "K1c")
    created_leads.append(lead_id_c)
    r = post_contract(rep_tok, base_contract_body(lead_id_c, signed_at=iso(now_utc - timedelta(days=3))))
    check(r.status_code == 400, "K1c handlowiec signed_at=3d ago → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("wczorajsza lub dzisiejsza" in msg, "K1c error msg mentions 'wczorajsza lub dzisiejsza'", msg)
    else:
        if r.status_code == 200:
            created_contracts.append(r.json()["id"])

    # d) 15 days ago → 400
    lead_id_d = create_lead(rep_tok, "K1d")
    created_leads.append(lead_id_d)
    r = post_contract(rep_tok, base_contract_body(lead_id_d, signed_at=iso(now_utc - timedelta(days=15))))
    check(r.status_code == 400, "K1d handlowiec signed_at=15d ago → 400", f"got {r.status_code}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # e) 2 days future → 400
    lead_id_e = create_lead(rep_tok, "K1e")
    created_leads.append(lead_id_e)
    r = post_contract(rep_tok, base_contract_body(lead_id_e, signed_at=iso(now_utc + timedelta(days=2))))
    check(r.status_code == 400, "K1e handlowiec signed_at=+2d future → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("przyszłości" in msg, "K1e error msg mentions 'przyszłości'", msg)
    else:
        if r.status_code == 200:
            created_contracts.append(r.json()["id"])

    # f) admin, 30 days ago → 200
    lead_id_f = create_lead(admin_tok, "K1f admin 30d back")
    created_leads.append(lead_id_f)
    r = post_contract(admin_tok, base_contract_body(lead_id_f, signed_at=iso(now_utc - timedelta(days=30))))
    check(r.status_code == 200, "K1f admin signed_at=30d ago → 200", f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # g) admin, 95 days ago → 400
    lead_id_g = create_lead(admin_tok, "K1g admin 95d")
    created_leads.append(lead_id_g)
    r = post_contract(admin_tok, base_contract_body(lead_id_g, signed_at=iso(now_utc - timedelta(days=95))))
    check(r.status_code == 400, "K1g admin signed_at=95d ago → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("90 dni wstecz" in msg, "K1g error msg mentions '90 dni wstecz'", msg)
    else:
        if r.status_code == 200:
            created_contracts.append(r.json()["id"])

    # ======================================================================
    # W2: commission_percent_override forbidden for handlowiec
    # ======================================================================
    print("\n--- W2: commission_percent_override ---")
    lw = create_lead(rep_tok, "W2 rep lead")
    created_leads.append(lw)
    r = post_contract(rep_tok, base_contract_body(lw, commission_percent_override=99))
    check(r.status_code == 403, "W2 handlowiec with override=99 → 403", f"got {r.status_code}")
    if r.status_code == 403:
        msg = r.json().get("detail", "")
        check("nie może nadpisywać" in msg, "W2 error msg contains 'Handlowiec nie może nadpisywać'", msg)
    elif r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # As manager — need lead in manager's team (rep is in manager's team)
    lw2 = create_lead(rep_tok, "W2 mgr lead")
    created_leads.append(lw2)
    r = post_contract(manager_tok, base_contract_body(lw2, commission_percent_override=99))
    check(r.status_code == 200, "W2 manager with override=99 → 200", f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        cid = r.json()["id"]
        created_contracts.append(cid)
        check(float(r.json().get("commission_percent", 0)) == 99, "W2 manager override → commission_percent=99")

    # As admin — admin can submit any lead
    lw3 = create_lead(admin_tok, "W2 admin lead")
    created_leads.append(lw3)
    r = post_contract(admin_tok, base_contract_body(lw3, commission_percent_override=99))
    check(r.status_code == 200, "W2 admin with override=99 → 200", f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        cid = r.json()["id"]
        created_contracts.append(cid)
        check(float(r.json().get("commission_percent", 0)) == 99, "W2 admin override → commission_percent=99")

    # ======================================================================
    # K5: Cross-field validation
    # ======================================================================
    print("\n--- K5: Cross-field validation ---")
    lk = create_lead(rep_tok, "K5 rep lead")
    created_leads.append(lk)

    # a) margin > gross
    r = post_contract(rep_tok, base_contract_body(lk, global_margin=60000, gross_amount=50000))
    check(r.status_code == 400, "K5a margin>gross → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("nie może być większa" in msg, "K5a err contains 'nie może być większa'", msg)
    elif r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # b) down_payment > gross (cash)
    r = post_contract(rep_tok, base_contract_body(lk, financing_type="cash", down_payment_amount=55000, gross_amount=50000))
    check(r.status_code == 400, "K5b down_payment>gross → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("nie może być większa" in msg.lower() or "większa" in msg, "K5b err mentions 'większa'", msg)
    elif r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # c) down_payment negative
    r = post_contract(rep_tok, base_contract_body(lk, financing_type="cash", down_payment_amount=-100))
    check(r.status_code == 400, "K5c down_payment<0 → 400", f"got {r.status_code}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # d) roof_area_m2 = 0
    r = post_contract(rep_tok, base_contract_body(lk, roof_area_m2=0))
    check(r.status_code == 400, "K5d roof_area=0 → 400", f"got {r.status_code}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # e) installments_count = 0
    r = post_contract(rep_tok, base_contract_body(lk, financing_type="cash", installments_count=0))
    check(r.status_code == 400, "K5e installments=0 → 400", f"got {r.status_code}")
    if r.status_code == 200:
        created_contracts.append(r.json()["id"])

    # Now PATCH tests — need a live contract as admin w/ gross=50000
    lpatch = create_lead(admin_tok, "K5 patch lead")
    created_leads.append(lpatch)
    r = post_contract(admin_tok, base_contract_body(lpatch, gross_amount=50000, global_margin=10000))
    assert r.status_code == 200, f"setup patch contract: {r.status_code} {r.text}"
    cid_patch = r.json()["id"]
    created_contracts.append(cid_patch)

    # f) PATCH total_paid_amount=60000 > 52500 → 400
    r = requests.patch(f"{BASE}/contracts/{cid_patch}", headers=hdr(admin_tok), json={"total_paid_amount": 60000}, timeout=20)
    check(r.status_code == 400, "K5f PATCH total_paid=60000 (>105% of 50000) → 400", f"got {r.status_code}")

    # g) total_paid_amount=52000 → 200
    r = requests.patch(f"{BASE}/contracts/{cid_patch}", headers=hdr(admin_tok), json={"total_paid_amount": 52000}, timeout=20)
    check(r.status_code == 200, "K5g PATCH total_paid=52000 (within 5%) → 200", f"got {r.status_code} {r.text[:200]}")

    # h) total_paid_amount=-10 → 400
    r = requests.patch(f"{BASE}/contracts/{cid_patch}", headers=hdr(admin_tok), json={"total_paid_amount": -10}, timeout=20)
    check(r.status_code == 400, "K5h PATCH total_paid=-10 → 400", f"got {r.status_code}")

    # ======================================================================
    # K6: Idempotency-Key
    # ======================================================================
    print("\n--- K6: Idempotency-Key ---")
    lk6 = create_lead(rep_tok, "K6 idempo")
    created_leads.append(lk6)
    idem_key = f"test-key-xyz-{uuid.uuid4().hex[:8]}"
    body_k6 = base_contract_body(lk6)

    r1 = post_contract(rep_tok, body_k6, headers_extra={"Idempotency-Key": idem_key})
    check(r1.status_code == 200, "K6.1 first POST with Idempotency-Key → 200", f"got {r1.status_code} {r1.text[:200]}")
    cid1 = r1.json().get("id") if r1.status_code == 200 else None
    if cid1:
        created_contracts.append(cid1)

    r2 = post_contract(rep_tok, body_k6, headers_extra={"Idempotency-Key": idem_key})
    check(r2.status_code == 200, "K6.2 replay SAME key → 200", f"got {r2.status_code}")
    cid2 = r2.json().get("id") if r2.status_code == 200 else None
    check(cid1 and cid2 and cid1 == cid2, "K6.3 replay returned SAME contract_id (no duplicate)", f"cid1={cid1} cid2={cid2}")

    # GET /contracts filter by lead_id+signed_at — just confirm only one contract for this lead
    r_list = requests.get(f"{BASE}/contracts", headers=hdr(rep_tok), timeout=20).json()
    count_for_lead = sum(1 for c in r_list if c.get("lead_id") == lk6)
    check(count_for_lead == 1, "K6.4 GET /contracts shows ONE contract for lead_id", f"found {count_for_lead}")

    # POST with DIFFERENT key → creates second
    idem_key2 = f"test-key-xyz-{uuid.uuid4().hex[:8]}"
    r3 = post_contract(rep_tok, body_k6, headers_extra={"Idempotency-Key": idem_key2})
    cid3 = r3.json().get("id") if r3.status_code == 200 else None
    check(r3.status_code == 200 and cid3 and cid3 != cid1, "K6.5 POST with NEW key → creates second contract", f"got {r3.status_code} cid3={cid3}")
    if cid3:
        created_contracts.append(cid3)

    # ======================================================================
    # W3: meeting_at validation
    # ======================================================================
    print("\n--- W3: meeting_at validation ---")
    lw3lead = create_lead(rep_tok, "W3 meet test")
    created_leads.append(lw3lead)

    # a) 2099 — > 2 years future → 400
    r = requests.patch(f"{BASE}/leads/{lw3lead}", headers=hdr(rep_tok), json={"status": "umowione", "meeting_at": "2099-01-01T10:00:00Z"}, timeout=20)
    check(r.status_code == 400, "W3a meeting_at=2099 → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("2 lata w przód" in msg or "2 lata" in msg, "W3a err msg '2 lata w przód'", msg)

    # b) 2020 — too old
    r = requests.patch(f"{BASE}/leads/{lw3lead}", headers=hdr(rep_tok), json={"meeting_at": "2020-01-01T10:00:00Z"}, timeout=20)
    check(r.status_code == 400, "W3b meeting_at=2020 → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("wcześniejszy niż wczoraj" in msg, "W3b err msg 'wcześniejszy niż wczoraj'", msg)

    # c) invalid string
    r = requests.patch(f"{BASE}/leads/{lw3lead}", headers=hdr(rep_tok), json={"meeting_at": "invalid-date"}, timeout=20)
    check(r.status_code == 400, "W3c meeting_at='invalid-date' → 400", f"got {r.status_code}")
    if r.status_code == 400:
        msg = r.json().get("detail", "")
        check("nieprawidłowy format" in msg.lower() or "nieprawidłowy format" in msg, "W3c err msg 'nieprawidłowy format'", msg)

    # d) tomorrow → 200
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    r = requests.patch(f"{BASE}/leads/{lw3lead}", headers=hdr(rep_tok), json={"meeting_at": iso(tomorrow)}, timeout=20)
    check(r.status_code == 200, "W3d meeting_at=tomorrow → 200", f"got {r.status_code} {r.text[:200]}")

    # e) null — clearing
    r = requests.patch(f"{BASE}/leads/{lw3lead}", headers=hdr(rep_tok), json={"meeting_at": None}, timeout=20)
    check(r.status_code == 200, "W3e meeting_at=null → 200", f"got {r.status_code} {r.text[:200]}")

    # ======================================================================
    # W9: contract_audit_log
    # ======================================================================
    print("\n--- W9: contract_audit_log ---")
    law = create_lead(admin_tok, "W9 audit lead")
    created_leads.append(law)
    r = post_contract(admin_tok, base_contract_body(law, financing_type="cash", down_payment_amount=0, installments_count=12, gross_amount=50000, global_margin=10000))
    assert r.status_code == 200, f"W9 create contract: {r.status_code} {r.text}"
    cid_w9 = r.json()["id"]
    created_contracts.append(cid_w9)

    # patch total_paid_amount=10000
    r = requests.patch(f"{BASE}/contracts/{cid_w9}", headers=hdr(admin_tok), json={"total_paid_amount": 10000}, timeout=20)
    check(r.status_code == 200, "W9 PATCH total_paid_amount=10000 → 200")
    # patch additional_costs=2000
    r = requests.patch(f"{BASE}/contracts/{cid_w9}", headers=hdr(admin_tok), json={"additional_costs": 2000, "additional_costs_note": "test"}, timeout=20)
    check(r.status_code == 200, "W9 PATCH additional_costs=2000 → 200")
    # patch cancelled=true
    r = requests.patch(f"{BASE}/contracts/{cid_w9}", headers=hdr(admin_tok), json={"cancelled": True}, timeout=20)
    check(r.status_code == 200, "W9 PATCH cancelled=true → 200")

    # GET audit-log as admin
    r = requests.get(f"{BASE}/contracts/{cid_w9}/audit-log", headers=hdr(admin_tok), timeout=20)
    check(r.status_code == 200, "W9 GET audit-log as admin → 200", f"got {r.status_code}")
    if r.status_code == 200:
        entries = r.json()
        check(len(entries) >= 3, f"W9 audit-log has >=3 entries (got {len(entries)})")
        required = {"id", "contract_id", "field", "old_value", "new_value", "changed_by", "changed_by_name", "changed_by_role", "changed_at"}
        if entries:
            e0 = entries[0]
            missing = required - set(e0.keys())
            check(not missing, "W9 audit entry has required fields", f"missing={missing}")
            # sorted desc
            times = [e["changed_at"] for e in entries]
            check(times == sorted(times, reverse=True), "W9 audit entries sorted by changed_at desc")
            # latest should be cancelled=true
            check(e0.get("field") == "cancelled" and e0.get("old_value") is False and e0.get("new_value") is True,
                  "W9 latest entry is cancelled (old=False, new=True)",
                  f"got field={e0.get('field')} old={e0.get('old_value')} new={e0.get('new_value')}")
            # find additional_costs entry for reason_note check
            for e in entries:
                if e.get("field") == "additional_costs":
                    check(e.get("reason_note") == "test", "W9 additional_costs entry has reason_note='test'", f"got {e.get('reason_note')}")
                    break

    # GET as manager (manager owns team that includes rep who created? No, contract was created by admin and rep_id=None.
    # But the contract has owner_manager_id=None too. Manager should be forbidden — unless the lead was owned by manager.
    # The admin-created lead has owner_manager_id=None. So manager should get 403.
    r = requests.get(f"{BASE}/contracts/{cid_w9}/audit-log", headers=hdr(manager_tok), timeout=20)
    # Could be 403 — depends on lead ownership. Just report
    print(f"    (info) manager audit-log access: {r.status_code}")

    # GET as handlowiec (unrelated) → 403 (contract has no rep_id)
    r = requests.get(f"{BASE}/contracts/{cid_w9}/audit-log", headers=hdr(rep_tok), timeout=20)
    check(r.status_code == 403, "W9 GET audit-log as unrelated handlowiec → 403", f"got {r.status_code}")

    # GET on nonexistent
    r = requests.get(f"{BASE}/contracts/nonexistent-xyz-999/audit-log", headers=hdr(admin_tok), timeout=20)
    check(r.status_code == 404, "W9 GET audit-log nonexistent → 404", f"got {r.status_code}")

    # Also: create rep-owned contract, verify rep + manager can access
    lrep_audit = create_lead(rep_tok, "W9 rep audit")
    created_leads.append(lrep_audit)
    r = post_contract(rep_tok, base_contract_body(lrep_audit))
    if r.status_code == 200:
        cid_rep = r.json()["id"]
        created_contracts.append(cid_rep)
        # make a PATCH as admin to create audit entry
        requests.patch(f"{BASE}/contracts/{cid_rep}", headers=hdr(admin_tok), json={"note": "audit test rep"}, timeout=20)
        # handlowiec (owner) gets access
        r = requests.get(f"{BASE}/contracts/{cid_rep}/audit-log", headers=hdr(rep_tok), timeout=20)
        check(r.status_code == 200, "W9 GET audit-log as owner handlowiec → 200", f"got {r.status_code}")
        # manager (manager of rep) gets access
        r = requests.get(f"{BASE}/contracts/{cid_rep}/audit-log", headers=hdr(manager_tok), timeout=20)
        check(r.status_code == 200, "W9 GET audit-log as manager (team) → 200", f"got {r.status_code}")

    # ======================================================================
    # Regression sanity
    # ======================================================================
    print("\n--- Regression ---")
    for name, creds in [("admin", ADMIN), ("manager", MANAGER), ("handlowiec", HANDLOWIEC)]:
        r = requests.post(f"{BASE}/auth/login", json=creds, timeout=20)
        check(r.status_code == 200, f"login {name} → 200")
        tok = r.json()["access_token"]
        r = requests.get(f"{BASE}/auth/me", headers=hdr(tok), timeout=20)
        check(r.status_code == 200, f"auth/me {name} → 200")
        r = requests.get(f"{BASE}/settings", headers=hdr(tok), timeout=20)
        check(r.status_code == 200, f"GET /settings {name} → 200")
        r = requests.get(f"{BASE}/dashboard/finance-v2", headers=hdr(tok), timeout=20)
        check(r.status_code == 200, f"GET /dashboard/finance-v2 {name} → 200")
        r = requests.get(f"{BASE}/calendar/meetings", headers=hdr(tok), timeout=20)
        check(r.status_code == 200, f"GET /calendar/meetings {name} → 200")

    # PUT /settings admin → 200, handlowiec → 403
    cur_settings = requests.get(f"{BASE}/settings", headers=hdr(admin_tok)).json()
    put_body = {k: v for k, v in cur_settings.items() if k not in ("id", "updated_at", "_id")}
    r = requests.put(f"{BASE}/settings", headers=hdr(admin_tok), json=put_body, timeout=20)
    check(r.status_code == 200, "PUT /settings admin → 200", f"got {r.status_code} {r.text[:200]}")
    r = requests.put(f"{BASE}/settings", headers=hdr(rep_tok), json=put_body, timeout=20)
    check(r.status_code == 403, "PUT /settings handlowiec → 403", f"got {r.status_code}")

    # Leads CRUD baseline
    r = requests.get(f"{BASE}/leads", headers=hdr(rep_tok), timeout=20)
    check(r.status_code == 200 and isinstance(r.json(), list), "GET /leads handlowiec → 200 array")

    # ======================================================================
    # Cleanup
    # ======================================================================
    print(f"\n--- Cleanup: {len(created_contracts)} contracts, {len(created_leads)} leads ---")
    for cid in set(created_contracts):
        try:
            admin_delete_contract(admin_tok, cid)
        except Exception:
            pass
    for lid in set(created_leads):
        try:
            admin_delete_lead(admin_tok, lid)
        except Exception:
            pass

    print("\n" + "=" * 80)
    print(f"RESULT: {len(PASS)} passed / {len(FAIL)} failed  (total {len(PASS)+len(FAIL)})")
    print("=" * 80)
    if FAIL:
        print("\nFAILED:")
        for f in FAIL:
            print(f"  - {f}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
