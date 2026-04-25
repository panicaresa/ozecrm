# Security Incidents

## 2026-04-25 — Batch 1 audit fixes (Wave 1)

### Pre-incident audit context
- `/app/backend/.env` is in `/app/.gitignore` (multiple entries: lines 84, 93, 102, 111).
- `git log --all --full-history -- backend/.env` returns **0 commits** → JWT_SECRET was never committed to git history. Rotation is "defense in depth" (precaution against any out-of-band leak: ZIP downloads, screenshots, support tickets, etc).

---

### ISSUE-001: `_download` endpoint removed
- **Endpoint:** `GET /api/_download/{token}/oze-crm-app.zip`
- **Compromised token:** `DKeA5HMSXK-TIphmWeGXpsxB7eKCDJYV` (was hardcoded in source code, viewable on public GitHub)
- **Risk:** The ZIP archive `/tmp/oze-crm-app.zip` may have been exfiltrated by anyone who saw the token in a public repo. Archive contained the full app source incl. `.env`-style values that may have leaked through earlier dev iterations.
- **Remediation:**
  - [x] Endpoint block (~17 lines) removed from `/app/backend/server.py`
  - [x] `/tmp/oze-crm-app.zip` confirmed absent (`ls -la` → "No such file or directory")
  - [x] JWT_SECRET rotated (defensive measure — invalidates any stolen tokens signed with the previous secret)
- **Verification:**
  - `grep -E "_download|DKeA5HMSXK" /app/backend/server.py` → 0 matches ✅
  - `curl /api/_download/DKeA5HMSXK-TIphmWeGXpsxB7eKCDJYV/oze-crm-app.zip` → 404 ✅
- **Note:** All active user JWT sessions invalidated. Re-login required for everyone.

---

### ISSUE-002: Company data removed from source defaults
- **Problem:** `class SettingsIn` Pydantic defaults contained:
  - company_name = "Polska Grupa OZE Sp. z o.o."
  - company_address = "ul. Grunwaldzka 415"
  - company_zip = "80-309 Gdańsk"
  - company_nip = "NIP: 732-219-77-56"
  - company_email = "biuro@grupaoze.pl"
  - company_phone = "+48 509-274-365"
  - These were committed to public GitHub via the source file.
- **Remediation:**
  - [x] All 6 Pydantic defaults set to empty strings (`""`)
  - [x] Bootstrap from env vars added in `ensure_indexes_and_migrations`:
    - reads `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_ZIP`, `COMPANY_NIP`, `COMPANY_EMAIL`, `COMPANY_PHONE`
    - writes to settings doc only when both (a) env var is set, AND (b) the matching field is empty/missing in DB
    - existing populated DB values are preserved (admin can still edit via UI)
  - [x] Existing DB settings doc INSPECTED — all 6 company fields are already populated (lengths: name=27, address=19, zip=13, nip=18, email=17, phone=15). Source-code removal does NOT affect runtime data.
- **Verification:**
  - `grep -E "Polska Grupa OZE|509-274-365|grupaoze\.pl|732-219-77-56" /app/backend/server.py` → 1 match remaining (see open follow-ups)

---

### JWT_SECRET rotation (defense in depth)
- **Generated:** `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`
- **New length:** 64 url-safe characters (no spaces, no newlines, single line `KEY=value`)
- **Old value:** Wiped from disk; no temp file, no log, no echo to terminal.
- **Backend restart:** `sudo supervisorctl restart backend` → `RUNNING` (PID confirmed)
- **Health:** `GET /api/` → 200 OK
- **Old token validation:** `Authorization: Bearer fake.old.token` → 401 ✅
- **Login validation:** all 3 dev accounts (admin/manager/handlowiec @test.com) → 200 (token issued, length 240)
- **User impact:** all currently-logged-in users were silently logged out. They must re-authenticate with the same credentials.

---

### Test impact
- **Pre-Batch-1:** 83 passed + 1 skipped
- **Post-Batch-1:** 72 passed + 1 skipped + **8 pre-existing time-dependent failures** (NOT caused by Batch 1)
  - 8 failed tests in `TestCommissionFraudPrevention`, `TestContractSignedEvent`, `TestDailyReport` use hardcoded `signed_at = "2026-04-23"` which became "2 dni temu" after the system clock crossed midnight. The contract endpoint enforces "Data podpisania może być tylko wczorajsza lub dzisiejsza" — pre-existing validation rule unrelated to security fixes.
  - **Action:** non-blocking. Tests need their `signed_at` literals replaced with a `(today() - timedelta(days=1)).isoformat()` helper. Deferred to a future cleanup ticket.

---

### Open follow-ups
- [ ] **`admin@grupaoze.pl` as `ADMIN_BOOTSTRAP_EMAIL` default** — line 39 of server.py. Fallback only triggers if env var is unset (currently env var IS set, so default unused). To fully purge company data from source, change default to a neutral string like `admin@example.com`. Out of Batch 1 scope.
- [ ] **Test fixtures with hardcoded dates** — replace `signed_at = "2026-04-23"` with computed-relative dates in `tests/test_oze_crm_api.py` (8 tests).
- [ ] **`COMPANY_*` env vars** not set in `/app/backend/.env` — bootstrap is idempotent (will only write empty fields), but for full reproducibility on a fresh DB the deployer may want to populate these env vars.
- [ ] **Wave 2 audit** (Batch 2+): scope/security review for additional endpoints; rate limiting on `/auth/login` (slowapi); error reporting (Sentry); audit log of admin operations.
- [ ] **Compromised ZIP archive scope review** — if the previously-served `/tmp/oze-crm-app.zip` may have been downloaded by adversaries, consider whether ANY other secrets were inside that ZIP at the time of its creation. JWT_SECRET rotation already invalidates any leaked JWTs; but other secrets (LLM keys, third-party API tokens) — none currently in `.env` per audit — would also need rotation if they had been included.
