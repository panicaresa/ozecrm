"""
Sprint 5-pre-quad backend smoke tests against public URL.
Validates phone+email in /dashboard/manager reps_live[] + backward compat.
"""
import os
import sys
import time
import requests

BASE_URL = "https://renewable-sales-hub.preview.emergentagent.com/api"

results = []
def record(name, ok, detail=""):
    status = "✅ PASS" if ok else "❌ FAIL"
    msg = f"{status} | {name}"
    if detail:
        msg += f" | {detail}"
    print(msg)
    results.append((name, ok, detail))


def login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login",
                      json={"email": email, "password": password},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    print("=" * 80)
    print("Sprint 5-pre-quad backend smoke (BASE_URL=" + BASE_URL + ")")
    print("=" * 80)

    # === Smoke a) login handlowiec and seed location ===
    try:
        rep_tok = login("handlowiec@test.com", "test1234")
        record("a1) login handlowiec@test.com", True)
    except Exception as e:
        record("a1) login handlowiec@test.com", False, str(e))
        return

    rh = {"Authorization": f"Bearer {rep_tok}"}
    r = requests.put(f"{BASE_URL}/rep/location",
                     headers=rh,
                     json={"latitude": 52.0, "longitude": 19.0, "accuracy": 5.0},
                     timeout=15)
    record("a2) PUT /rep/location latitude=52.0 longitude=19.0 → 200",
           r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")

    # Seed extra reps so reps_live has multiple entries
    for i, email in enumerate(("anna@test.com", "piotr@test.com", "ewa@test.com")):
        try:
            tok = login(email, "test1234")
            rr = requests.put(f"{BASE_URL}/rep/location",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"latitude": 52.0 + 0.1 * (i + 1),
                                    "longitude": 19.0 + 0.1 * (i + 1),
                                    "accuracy": 5.0},
                              timeout=15)
            print(f"  seeded location for {email}: {rr.status_code}")
        except Exception as e:
            print(f"  failed seeding {email}: {e}")

    # === Smoke b) login manager + GET /dashboard/manager ===
    try:
        mgr_tok = login("manager@test.com", "test1234")
        record("b1) login manager@test.com", True)
    except Exception as e:
        record("b1) login manager@test.com", False, str(e))
        return

    mh = {"Authorization": f"Bearer {mgr_tok}"}
    r = requests.get(f"{BASE_URL}/dashboard/manager", headers=mh, timeout=20)
    record("b2) GET /dashboard/manager → 200",
           r.status_code == 200,
           f"status={r.status_code}")

    if r.status_code != 200:
        return

    payload = r.json()
    reps_live = payload.get("reps_live", [])
    record("b3) reps_live[] is non-empty",
           len(reps_live) > 0,
           f"count={len(reps_live)}")

    if not reps_live:
        return

    # === Smoke c) Verify phone+email and existing fields on first rep ===
    first = reps_live[0]
    print(f"\nFirst rep payload:\n  {first}\n")

    has_phone_key = "phone" in first
    has_email_key = "email" in first
    record("c1) reps_live[0] has 'phone' key", has_phone_key)
    record("c2) reps_live[0] has 'email' key", has_email_key)

    # Existing fields no regression
    for f in ("user_id", "name", "lat", "lng"):
        record(f"c3) reps_live[0] has '{f}' key (no regression)",
               f in first,
               f"value={first.get(f)!r}")

    # Email format check (must contain @ and .)
    email_val = first.get("email")
    record("c4) reps_live[0].email is parseable address",
           isinstance(email_val, str) and "@" in email_val and "." in email_val,
           f"email={email_val!r}")

    # === Smoke d) Verify phone is non-null for all seeded users ===
    seeded_emails = {
        "manager@test.com",
        "handlowiec@test.com",
        "anna@test.com",
        "piotr@test.com",
        "ewa@test.com",
    }

    found_emails = set()
    missing_phone = []
    for rep in reps_live:
        em = rep.get("email")
        if em in seeded_emails:
            found_emails.add(em)
            ph = rep.get("phone")
            if not ph or not isinstance(ph, str) or not ph.strip():
                missing_phone.append(em)
            else:
                # Check Polish prefix +48
                ok_prefix = ph.startswith("+48")
                record(f"d1) phone for {em} starts with +48",
                       ok_prefix,
                       f"phone={ph!r}")

    record("d2) reps_live contains at least 4 seeded reps",
           len(found_emails) >= 4,
           f"found={sorted(found_emails)}")

    record("d3) phone non-null for all seeded reps in reps_live",
           len(missing_phone) == 0,
           f"missing={missing_phone}")

    # === Backward compat 1: PUT /rep/location/batch ===
    batch_body = {
        "points": [
            {"latitude": 52.10, "longitude": 19.10, "accuracy": 5.0},
            {"latitude": 52.20, "longitude": 19.20, "accuracy": 5.0},
            {"latitude": 52.30, "longitude": 19.30, "accuracy": 5.0},
        ]
    }
    r = requests.put(f"{BASE_URL}/rep/location/batch",
                     headers=rh,
                     json=batch_body,
                     timeout=15)
    record("bc1) PUT /rep/location/batch (3 distinct points) → 200",
           r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")

    # === Backward compat 2: POST /contracts auto-flips lead.status ===
    # First create a fresh lead as handlowiec
    # base64 PNG padded to >=100 chars (backend rule)
    photo_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=" + "A" * 64
    from datetime import datetime, timedelta, timezone
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    import random
    rand_lat = 54.0 + random.uniform(0.001, 0.5)
    rand_lng = 18.0 + random.uniform(0.001, 0.5)
    lead_body = {
        "client_name": "Sprint5PreQuad Test " + str(int(time.time())),
        "phone": "+48 600 000 000",
        "address": "Testowa 1, Gdańsk",
        "status": "umowione",
        "building_type": "mieszkalny",
        "building_area": 100.0,
        "latitude": rand_lat,
        "longitude": rand_lng,
        "meeting_at": tomorrow,
        "photo_base64": photo_b64,
    }
    r = requests.post(f"{BASE_URL}/leads", headers=rh, json=lead_body, timeout=15)
    record("bc2a) POST /leads (umowione) → 200",
           r.status_code == 200,
           f"status={r.status_code} body={r.text[:300]}")
    if r.status_code != 200:
        return

    new_lead = r.json()
    lead_id = new_lead["id"]

    # Create contract – yesterday signed_at
    from datetime import datetime, timedelta, timezone
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    contract_body = {
        "lead_id": lead_id,
        "client_name": new_lead["client_name"],
        "signed_at": yesterday,
        "buildings_count": 1,
        "building_type": "mieszkalny",
        "roof_area_m2": 100.0,
        "gross_amount": 50000.0,
        "financing_type": "cash",
        "down_payment_amount": 5000.0,
        "installments_count": 12,
        "total_paid_amount": 5000.0,
    }
    r = requests.post(f"{BASE_URL}/contracts",
                      headers={**rh, "Idempotency-Key": f"s5pq-{int(time.time())}"},
                      json=contract_body,
                      timeout=15)
    record("bc2b) POST /contracts → 200",
           r.status_code == 200,
           f"status={r.status_code} body={r.text[:300]}")

    if r.status_code == 200:
        # Verify lead.status flipped
        r2 = requests.get(f"{BASE_URL}/leads", headers=mh, timeout=15)
        if r2.status_code == 200:
            leads = r2.json()
            updated = next((l for l in leads if l.get("id") == lead_id), None)
            record("bc2c) lead.status auto-flipped to 'podpisana'",
                   updated is not None and updated.get("status") == "podpisana",
                   f"status={updated.get('status') if updated else None!r}")
            record("bc2d) lead.status_auto_changed_reason set",
                   updated is not None and updated.get("status_auto_changed_reason") == "contract_created",
                   f"reason={updated.get('status_auto_changed_reason') if updated else None!r}")

    # Summary
    print("\n" + "=" * 80)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"TOTAL: {passed}/{len(results)} passed, {failed} failed")
    print("=" * 80)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
