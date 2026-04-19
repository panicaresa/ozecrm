"""
Backend tests for OZE CRM Phase 1.5 — Commission settings + regressions.
"""
import os
import sys
import json
import requests

BASE_URL = os.environ.get(
    "BACKEND_URL",
    "https://renewable-sales-hub.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    marker = PASS if ok else FAIL
    print(f"[{marker}] {name}" + (f"  -> {detail}" if detail else ""))


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    return r


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    tokens = {}

    # ---------------------------------------------------------------- AUTH
    print("\n=== 1) AUTH sanity ===")
    expected_roles = {
        "admin@test.com": "admin",
        "manager@test.com": "manager",
        "handlowiec@test.com": "handlowiec",
    }
    for email, expected_role in expected_roles.items():
        r = login(email, "test1234")
        ok = (
            r.status_code == 200
            and "access_token" in r.json()
            and r.json().get("user", {}).get("role") == expected_role
        )
        record(f"login {email} (role={expected_role})", ok, f"status={r.status_code} body={r.text[:200] if not ok else 'ok'}")
        if r.status_code == 200:
            tokens[expected_role] = r.json()["access_token"]

    # /auth/me
    for role, token in tokens.items():
        r = requests.get(f"{API}/auth/me", headers=headers(token), timeout=30)
        ok = r.status_code == 200 and r.json().get("role") == role
        record(f"/auth/me {role}", ok, f"status={r.status_code}")

    # wrong password
    r = login("admin@test.com", "WRONG_PASSWORD_999")
    record("login wrong password -> 401", r.status_code == 401, f"status={r.status_code}")

    if not all(k in tokens for k in ("admin", "manager", "handlowiec")):
        print("\nAuth failed – cannot continue remaining tests")
        sys.exit(1)

    # ------------------------------------------------------------ SETTINGS
    print("\n=== 2) SETTINGS ===")
    settings_snapshot = None
    for role in ("admin", "manager", "handlowiec"):
        r = requests.get(f"{API}/settings", headers=headers(tokens[role]), timeout=30)
        ok = r.status_code == 200
        detail = f"status={r.status_code}"
        if ok:
            s = r.json()
            required_fields = [
                "commission_percent", "margin_per_m2", "base_price_low",
                "base_price_high", "default_margin", "rrso_rates",
                "excluded_zip_codes", "company_name", "company_address",
                "company_zip", "company_nip", "company_email", "company_phone",
            ]
            missing = [f for f in required_fields if f not in s]
            if missing:
                ok = False
                detail = f"missing fields: {missing}"
            else:
                # default expectations (only validate on first fetch as admin)
                if role == "admin":
                    settings_snapshot = s
                    expectations = {
                        "commission_percent": 50,
                        "margin_per_m2": 50,
                        "base_price_low": 275,
                        "base_price_high": 200,
                        "default_margin": 10000,
                    }
                    bad = {k: s[k] for k, v in expectations.items() if float(s[k]) != float(v)}
                    if bad:
                        # Don't hard fail – persisted state may have been changed.
                        detail = (
                            f"status=200 (note: values differ from defaults {bad} "
                            f"— acceptable if previously modified)"
                        )
                    if not s.get("rrso_rates"):
                        ok = False
                        detail = "rrso_rates is empty"
        record(f"GET /settings as {role}", ok, detail)

    if settings_snapshot is None:
        # Fallback: settings doc in DB was created before new fields existed.
        # Build a snapshot from defaults so we can still exercise PUT behavior.
        print("\n!! GET /settings missing new fields — using defaults to continue PUT tests")
        r = requests.get(f"{API}/settings", headers=headers(tokens["admin"]), timeout=30)
        base = r.json() if r.status_code == 200 else {}
        settings_snapshot = {
            "base_price_low": base.get("base_price_low", 275.0),
            "base_price_high": base.get("base_price_high", 200.0),
            "default_margin": base.get("default_margin", 10000.0),
            "default_discount": base.get("default_discount", 2000.0),
            "default_subsidy": base.get("default_subsidy", 20000.0),
            "default_months": base.get("default_months", 119),
            "commission_percent": base.get("commission_percent", 50.0),
            "margin_per_m2": base.get("margin_per_m2", 50.0),
            "rrso_rates": base.get("rrso_rates", []),
            "excluded_zip_codes": base.get("excluded_zip_codes", []),
            "company_name": base.get("company_name", "Polska Grupa OZE Sp. z o.o."),
            "company_address": base.get("company_address", "ul. Grunwaldzka 415"),
            "company_zip": base.get("company_zip", "80-309 Gdańsk"),
            "company_nip": base.get("company_nip", "NIP: 732-219-77-56"),
            "company_email": base.get("company_email", "biuro@grupaoze.pl"),
            "company_phone": base.get("company_phone", "+48 509-274-365"),
        }

    # PUT /settings as admin – modify commission_percent + margin_per_m2
    mod_body = {k: v for k, v in settings_snapshot.items() if k not in ("id", "updated_at", "_id")}
    mod_body["commission_percent"] = 42.5
    mod_body["margin_per_m2"] = 75.0
    r = requests.put(f"{API}/settings", headers=headers(tokens["admin"]), json=mod_body, timeout=30)
    ok = r.status_code == 200 and r.json().get("commission_percent") == 42.5 and r.json().get("margin_per_m2") == 75.0
    record("PUT /settings admin (42.5 / 75.0)", ok, f"status={r.status_code} body={r.text[:200] if not ok else 'ok'}")

    # GET verifies persistence
    r = requests.get(f"{API}/settings", headers=headers(tokens["admin"]), timeout=30)
    ok = r.status_code == 200 and r.json().get("commission_percent") == 42.5 and r.json().get("margin_per_m2") == 75.0
    record("GET /settings persistence check", ok, f"status={r.status_code} commission={r.json().get('commission_percent')} margin={r.json().get('margin_per_m2')}")

    # Restore defaults
    restore_body = dict(mod_body)
    restore_body["commission_percent"] = 50.0
    restore_body["margin_per_m2"] = 50.0
    r = requests.put(f"{API}/settings", headers=headers(tokens["admin"]), json=restore_body, timeout=30)
    ok = r.status_code == 200 and r.json().get("commission_percent") == 50.0 and r.json().get("margin_per_m2") == 50.0
    record("PUT /settings admin restore (50 / 50)", ok, f"status={r.status_code}")

    # PUT /settings non-admin → 403
    for role in ("manager", "handlowiec"):
        r = requests.put(f"{API}/settings", headers=headers(tokens[role]), json=restore_body, timeout=30)
        record(f"PUT /settings as {role} -> 403", r.status_code == 403, f"status={r.status_code}")

    # ---------------------------------------------------------- REGRESSIONS
    print("\n=== 3) REGRESSIONS ===")

    # Manager dashboard
    r = requests.get(f"{API}/dashboard/manager", headers=headers(tokens["manager"]), timeout=30)
    ok = r.status_code == 200
    if ok:
        b = r.json()
        keys = ["kpi", "status_breakdown", "rep_progress", "pins", "reps_live"]
        missing = [k for k in keys if k not in b]
        if missing:
            ok = False
            record("GET /dashboard/manager", False, f"missing keys {missing}")
        else:
            record("GET /dashboard/manager", True, f"reps={len(b['rep_progress'])} pins={len(b['pins'])}")
    else:
        record("GET /dashboard/manager", False, f"status={r.status_code}")

    # Rep dashboard
    r = requests.get(f"{API}/dashboard/rep", headers=headers(tokens["handlowiec"]), timeout=30)
    ok = r.status_code == 200
    if ok:
        b = r.json()
        ok = all(k in b for k in ("total_leads", "signed", "meetings", "target", "percent"))
    record("GET /dashboard/rep (handlowiec)", ok, f"status={r.status_code}")

    # /leads GET as handlowiec
    r = requests.get(f"{API}/leads", headers=headers(tokens["handlowiec"]), timeout=30)
    ok = r.status_code == 200 and isinstance(r.json(), list)
    record("GET /leads (handlowiec)", ok, f"status={r.status_code} count={len(r.json()) if ok else 'n/a'}")

    # Create lead as handlowiec
    lead_body = {
        "client_name": "Test Kalkulator",
        "status": "nowy",
        "building_area": 180,
        "building_type": "mieszkalny",
    }
    r = requests.post(f"{API}/leads", headers=headers(tokens["handlowiec"]), json=lead_body, timeout=30)
    ok = r.status_code == 200 and r.json().get("id")
    lead_id = r.json().get("id") if ok else None
    record("POST /leads (handlowiec)", ok, f"status={r.status_code} id={lead_id}")

    if lead_id:
        # PATCH status
        r = requests.patch(
            f"{API}/leads/{lead_id}",
            headers=headers(tokens["handlowiec"]),
            json={"status": "umowione"},
            timeout=30,
        )
        ok = r.status_code == 200 and r.json().get("status") == "umowione"
        record("PATCH /leads/{id} -> umowione", ok, f"status={r.status_code}")

        # handlowiec DELETE -> 403
        r = requests.delete(f"{API}/leads/{lead_id}", headers=headers(tokens["handlowiec"]), timeout=30)
        record("DELETE /leads as handlowiec -> 403", r.status_code == 403, f"status={r.status_code}")

        # admin DELETE -> 200
        r = requests.delete(f"{API}/leads/{lead_id}", headers=headers(tokens["admin"]), timeout=30)
        record("DELETE /leads as admin -> 200", r.status_code == 200, f"status={r.status_code}")

    # Rep location PUT
    r = requests.put(
        f"{API}/rep/location",
        headers=headers(tokens["handlowiec"]),
        json={"latitude": 54.37, "longitude": 18.63, "battery": 0.85, "battery_state": "unplugged"},
        timeout=30,
    )
    ok = r.status_code == 200 and r.json().get("ok") is True
    record("PUT /rep/location (handlowiec)", ok, f"status={r.status_code}")

    # Verify manager dashboard shows that rep
    r = requests.get(f"{API}/dashboard/manager", headers=headers(tokens["manager"]), timeout=30)
    ok = False
    detail = f"status={r.status_code}"
    if r.status_code == 200:
        handlowiec_me = requests.get(f"{API}/auth/me", headers=headers(tokens["handlowiec"]), timeout=30).json()
        reps_live = r.json().get("reps_live", [])
        ok = any(rl.get("user_id") == handlowiec_me.get("id") for rl in reps_live)
        detail = f"reps_live_count={len(reps_live)} contains_handlowiec={ok}"
    record("manager dashboard reps_live contains handlowiec", ok, detail)

    # ------------------------------------------------------ NEGATIVE CASES
    print("\n=== 4) NEGATIVE CASES ===")
    r = requests.put(f"{API}/settings", json=restore_body, timeout=30)
    record("PUT /settings without auth -> 401", r.status_code == 401, f"status={r.status_code}")
    r = requests.get(f"{API}/settings", timeout=30)
    record("GET /settings without auth -> 401", r.status_code == 401, f"status={r.status_code}")

    # --- summary
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n================ SUMMARY: {passed}/{total} passed ================")
    fails = [(n, d) for n, ok, d in results if not ok]
    if fails:
        print("FAILED:")
        for n, d in fails:
            print(f"  - {n}: {d}")
        sys.exit(1)


if __name__ == "__main__":
    main()
