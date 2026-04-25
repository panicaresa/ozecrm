"""
Sprint 5-pre-bis ISSUE-UX-001 — Manual smoke test for auto-lead-status feature.

Tests:
a) Login as handlowiec
b) POST /api/leads with status=umowione + photo + GPS
c) POST /api/contracts → expect lead.status auto-flips to "podpisana"
d) Manager GET /api/leads to verify auto-flip metadata
e) Second contract on same lead (different idempotency key) → no double audit
f) Idempotent replay (same Idempotency-Key) → same contract id, audit unchanged
g) Sanity: PUT /api/rep/location/batch (regression check)
"""
import os
import sys
import time
import base64
import datetime as dt
import requests

BASE = "https://renewable-sales-hub.preview.emergentagent.com"
API = f"{BASE}/api"

CREDS = {
    "admin": ("admin@test.com", "test1234"),
    "manager": ("manager@test.com", "test1234"),
    "handlowiec": ("handlowiec@test.com", "test1234"),
}


def login(role):
    email, pw = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(tok, extra=None):
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def yesterday_iso():
    return (dt.date.today() - dt.timedelta(days=1)).isoformat()


def tiny_b64_image():
    # 1x1 PNG
    raw = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
    )
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def main():
    results = []

    def step(label, ok, detail=""):
        status = "PASS" if ok else "FAIL"
        line = f"[{status}] {label}"
        if detail:
            line += f"  -- {detail}"
        print(line)
        results.append((label, ok, detail))

    # --- a) login handlowiec ---
    try:
        h_tok = login("handlowiec")
        step("a) login handlowiec", True)
    except Exception as e:
        step("a) login handlowiec", False, str(e))
        return

    # --- b) POST /api/leads as handlowiec ---
    ts = int(time.time())
    client_name = f"AUTO_TEST_{ts}"
    lead_body = {
        "client_name": client_name,
        "phone": "+48500000111",
        "address": "ul. Auto Test 1, Grudziądz",
        "latitude": 53.5 + (ts % 1000) * 0.00001,
        "longitude": 18.0 + (ts % 1000) * 0.00001,
        "building_type": "mieszkalny",
        "building_area": 100,
        "status": "umowione",
        "photo_base64": tiny_b64_image(),
        "meeting_at": (dt.datetime.utcnow() + dt.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    r = requests.post(f"{API}/leads", json=lead_body, headers=H(h_tok), timeout=30)
    if r.status_code != 200:
        step("b) POST /api/leads (umowione)", False, f"{r.status_code} {r.text[:300]}")
        return
    lead = r.json()
    lead_id = lead["id"]
    step("b) POST /api/leads (umowione)", lead.get("status") == "umowione",
         f"id={lead_id} status={lead.get('status')}")

    # --- c) POST /api/contracts ---
    contract_body = {
        "lead_id": lead_id,
        "building_type": "mieszkalny",
        "roof_area_m2": 100,
        "panele_kw": 5,
        "panele_price": 25000,
        "magazyn_kwh": 5,
        "magazyn_price": 15000,
        "modernizacja_dachu": False,
        "dach_price": 0,
        "gross_amount": 45000,
        "klient_pesel_last4": "1234",
        "financing_type": "cash",
        "signed_at": yesterday_iso(),
        "client_signature_b64": base64.b64encode(b"sig").decode(),
        "down_payment_amount": 5000,
    }
    idem1 = f"sprint5prebis-{ts}-1"
    r = requests.post(
        f"{API}/contracts",
        json=contract_body,
        headers=H(h_tok, {"Idempotency-Key": idem1}),
        timeout=30,
    )
    if r.status_code != 200:
        step("c) POST /api/contracts", False, f"{r.status_code} {r.text[:500]}")
        return
    c1 = r.json()
    contract_id_1 = c1.get("id")
    step("c) POST /api/contracts", bool(contract_id_1), f"contract_id={contract_id_1}")

    # --- d) Manager GET /api/leads → verify auto-flip ---
    m_tok = login("manager")
    r = requests.get(f"{API}/leads", headers=H(m_tok), timeout=15)
    if r.status_code != 200:
        step("d) manager GET /api/leads", False, f"{r.status_code}")
        return
    found = next((x for x in r.json() if x.get("id") == lead_id), None)
    if not found:
        step("d) manager finds lead", False, f"lead_id={lead_id} not in {len(r.json())} leads")
        return
    ok_status = found.get("status") == "podpisana"
    ok_reason = found.get("status_auto_changed_reason") == "contract_created"
    ok_at = bool(found.get("status_auto_changed_at"))
    step("d.1) lead.status == 'podpisana'", ok_status, f"got {found.get('status')}")
    step("d.2) status_auto_changed_reason", ok_reason, f"got {found.get('status_auto_changed_reason')}")
    step("d.3) status_auto_changed_at non-null", ok_at, f"got {found.get('status_auto_changed_at')}")

    # --- e) Repeat POST /api/contracts with NEW idem key → new contract, lead still podpisana, no extra audit ---
    # Snapshot audit count before
    a_tok = login("admin")
    r_audit_before = requests.get(f"{API}/leads/{lead_id}/audit-log", headers=H(a_tok), timeout=15) \
        if False else None  # endpoint may not exist; inspect lead doc instead
    # Use direct lead fetch via manager dashboard or /api/leads (already have it).
    prev_auto_at = found.get("status_auto_changed_at")

    # Need slightly different content (e.g., note) for second create — keep most fields same but the lead is the same so will just create another contract.
    contract_body_2 = dict(contract_body)
    contract_body_2["note"] = "second contract"
    idem2 = f"sprint5prebis-{ts}-2"
    r = requests.post(
        f"{API}/contracts",
        json=contract_body_2,
        headers=H(h_tok, {"Idempotency-Key": idem2}),
        timeout=30,
    )
    if r.status_code != 200:
        step("e) second POST /api/contracts (new idem key)", False, f"{r.status_code} {r.text[:300]}")
    else:
        c2 = r.json()
        step("e.1) second POST returns 200 with new id", c2.get("id") and c2.get("id") != contract_id_1,
             f"id1={contract_id_1} id2={c2.get('id')}")

    # Re-fetch lead and verify status still podpisana, status_auto_changed_at unchanged
    r = requests.get(f"{API}/leads", headers=H(m_tok), timeout=15)
    found2 = next((x for x in r.json() if x.get("id") == lead_id), {})
    step("e.2) lead.status STILL 'podpisana'", found2.get("status") == "podpisana",
         f"status={found2.get('status')}")
    step("e.3) status_auto_changed_at NOT updated again",
         found2.get("status_auto_changed_at") == prev_auto_at,
         f"prev={prev_auto_at} new={found2.get('status_auto_changed_at')}")

    # --- f) Idempotent replay: POST contract twice with SAME Idempotency-Key ---
    idem3 = f"sprint5prebis-{ts}-3"
    body3 = dict(contract_body)
    body3["note"] = "idempotency replay test"
    r1 = requests.post(f"{API}/contracts", json=body3, headers=H(h_tok, {"Idempotency-Key": idem3}), timeout=30)
    r2 = requests.post(f"{API}/contracts", json=body3, headers=H(h_tok, {"Idempotency-Key": idem3}), timeout=30)
    if r1.status_code == 200 and r2.status_code == 200:
        id_a = r1.json().get("id")
        id_b = r2.json().get("id")
        step("f.1) idempotency replay returns same contract_id", id_a == id_b, f"a={id_a} b={id_b}")
    else:
        step("f.1) idempotency replay both 200", False, f"r1={r1.status_code} r2={r2.status_code}")

    # --- g) Regression: PUT /api/rep/location/batch ---
    pts = [
        {"latitude": 53.500, "longitude": 18.000, "accuracy": 12, "ts": dt.datetime.utcnow().isoformat() + "Z"},
        {"latitude": 53.501, "longitude": 18.001, "accuracy": 11, "ts": dt.datetime.utcnow().isoformat() + "Z"},
        {"latitude": 53.502, "longitude": 18.002, "accuracy": 10, "ts": dt.datetime.utcnow().isoformat() + "Z"},
    ]
    r = requests.put(f"{API}/rep/location/batch", json={"points": pts}, headers=H(h_tok), timeout=15)
    step("g.1) PUT /api/rep/location/batch with 3 distinct pts", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    r = requests.delete(f"{API}/rep/location", headers=H(h_tok), timeout=15)
    step("g.2) DELETE /api/rep/location reset", r.status_code in (200, 204), f"{r.status_code}")

    # ---- summary ----
    failed = [r for r in results if not r[1]]
    print("\n" + "=" * 70)
    print(f"Total: {len(results)}  Passed: {len(results)-len(failed)}  Failed: {len(failed)}")
    if failed:
        print("FAILED:")
        for n, _, d in failed:
            print(f"  - {n}  ({d})")
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
