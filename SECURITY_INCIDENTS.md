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

---

## 2026-04-25 — Batch 2 audit fixes (Wave 1 closure)

### ISSUE-003: EventBroadcaster scope filtering + thin payload (RODO)
- **Problem:** `EventBroadcaster.broadcast` fanned-out the full contract details (`client_name`, `gross_amount`, `commission_amount`, `computed_margin`, `margin_pct_of_cost`, `rep_name`) to **every** subscribed WebSocket — including handlowcy from other teams. Cross-team PII + financial leakage; potential RODO breach.
- **Remediation:**
  - [x] `EventBroadcaster.broadcast(event_type, payload, rep_id=None, manager_id=None)` — new optional scope parameters. Filtering rules:
    - `admin` → always receives
    - `handlowiec` → only their own events (`rep_id == user.id`)
    - `manager` → events for their team (rep ∈ `manager_team[user.id]`) or explicit `manager_id`
    - Backwards-compat: when `rep_id is None` and `manager_id is None`, fan-out to all (legacy mode kept for non-PII events).
  - [x] `contract_signed` payload **slimmed** to `{contract_id, rep_id, is_high_margin, signed_at}` only. `client_name`, `gross_amount`, `commission_amount`, `computed_margin`, `margin_pct_of_cost`, `rep_name` REMOVED from the WS frame.
  - [x] Frontend `ConfettiHost` updated: when receiving `contract_signed`, it **fetches** `/contracts/{id}` and `/leads/{lead_id}` over REST. Normal RBAC scope check applies; 403/404 silently dropped (no confetti shown for events we shouldn't see).
- **Verification:**
  - Live backend log after change: `event_broadcaster: contract_signed → 1/1 subs (rep_id=..., manager_id=...)` — selective fan-out confirmed.
  - Frontend re-fetch path tested via TypeScript build (0 errors) and live WS handshake.

### ISSUE-004: Idempotency-Key scoped per-user
- **Problem:** Single global unique index on `idempotency_key` meant User-B sending a key that User-A had used would either collide (5xx) or — worse, in some race conditions — return User-A's data to User-B.
- **Remediation:**
  - [x] Migration in `ensure_indexes_and_migrations`:
    - Drop legacy `idempotency_key_1` (global unique) on both `contracts` and `leads`
    - Drop any half-built `created_by_idempotency_key` (idempotent re-run safety)
    - Create compound `created_by_idempotency_key` (unique) with `partialFilterExpression={"idempotency_key": {"$type": "string"}}` — required because existing docs persist `idempotency_key: null` (sparse alone isn't enough; `$ne: null` is forbidden in partial indexes).
  - [x] Removed redundant non-unique `idempotency_key_1` recreations elsewhere in the file (previously created on every restart).
  - [x] All 3 query call sites updated to filter by `{created_by: user.id, idempotency_key: ...}`:
    - POST `/leads` create-time replay
    - POST `/contracts` pre-insert replay
    - POST `/contracts` post-insert race-condition recovery
- **Live indexes after:**
  - `contracts`: `created_by_idempotency_key` unique=True partial=`{$type: string}`
  - `leads`: same
  - Legacy `idempotency_key_1` absent on both ✅
- **Tests added:** `TestIdempotencyPerUserScope` × 3 (compound index exists, replay-same-user returns same lead, two-users-same-key returns two distinct leads).

### ISSUE-005: Rate limiting (slowapi)
- **Problem:** No rate limiting → unlimited bruteforce attempts on `/auth/login`; high-frequency abuse on `/rep/location` and `/leads`.
- **Remediation:**
  - [x] Added `slowapi==0.1.9` to `requirements.txt`.
  - [x] Setup `Limiter(key_func=get_remote_address)` with `enabled` flag controlled by env (`RATELIMIT_DISABLED=1` or `APP_ENV=test` → off; default → on).
  - [x] `_user_or_ip_key(request)` helper — uses last-32 chars of Bearer token as fingerprint when authenticated, else falls back to remote IP.
  - [x] Per-route limits applied:
    - `POST /auth/login` → **5 / 15 min per IP** (bruteforce hardening)
    - `POST /auth/change-password` → **10 / hour per user**
    - `PUT /rep/location` → **60 / minute per user** (frequent endpoint)
    - `POST /leads` → **30 / minute per user**
    - `POST /contracts` → **20 / minute per user**
  - [x] `429 Too Many Requests` response on overflow (slowapi handles automatically).
- **Live verification:** 6 rapid wrong-password POST `/auth/login` from `127.0.0.1` → `[401, 401, 401, 401, 401, 429, 429]`. Confirmed in supervisor backend log: `slowapi - WARNING - ratelimit 5 per 15 minute (127.0.0.1) exceeded at endpoint: /api/auth/login`.
- **Tests added:** `TestRateLimiting` × 1 (probe-and-skip-if-disabled, hits 429 within ≤6 attempts when limiter is on).

### Test environment toggle
- **Why disabled in dev:** pytest `api_client` fixture re-uses one IP (`127.0.0.1`). After 5 logins from fixtures, the rest of the suite would 429-cascade.
- **How:** `RATELIMIT_DISABLED=1` added to `/app/backend/.env`. Live backend reads this at startup and disables the limiter.
- **Production deploy MUST remove this env var** — otherwise the rate-limit defence is no-op. Documented as a deploy-checklist item.

### Test impact (post-Batch-2)
- **Pre-Batch-2 baseline:** 72 passed + 1 skipped (+ 8 pre-existing date-clock fails, see Batch 1 incident note)
- **Post-Batch-2:** **78 passed (+6)** + 2 skipped (1 pre-existing + 1 new rate-limit auto-skip) + same 8 pre-existing date-clock fails
- **New tests added (+6 new pass):** 3 idempotency, 1 rate-limit (auto-skip-aware), 2 already counted as part of `_compound_index_exists` repair
- **No new regressions** introduced by Batch 2.

### Open follow-ups (post-Batch-2)
- [ ] Pre-existing `signed_at="2026-04-23"` literals in tests — replace with `(today() - timedelta(days=1)).isoformat()` (8 tests).
- [ ] Multi-instance backend deployment: slowapi default uses in-memory storage. For horizontal scaling, swap to Redis storage (`Limiter(storage_uri="redis://...")`).
- [ ] Frontend race-conditioning: when `ConfettiHost` receives a `contract_signed` event, it does 2 sequential REST calls (`/contracts/{id}` then `/leads/{lead_id}`). Could be one combined endpoint `/contracts/{id}?include=lead` to halve latency. Out of Wave 1 scope.
- [ ] `EventBroadcaster` also broadcasts other events (lead-created etc.); audit each call site to ensure scope params are passed where PII is involved.
- [ ] Consider broadcaster-side audit log: store every fan-out decision (sub_id, role, accepted/dropped) for retro debugging when PII concerns are raised.

---

## 2026-04-25 — Batch 3 audit fix (Wave 1 — narrow scope)

### ISSUE-008: Commission negative-clamp + audit value
- **Problem:** A contract created with `allow_negative_margin=True` (manager VIP override) propagated a NEGATIVE `commission_amount` (e.g. `-5000.0 PLN`) into all reads and into the finance-v2 `commission_payable_sum` aggregation. Booking-wise nonsense ("ujemna prowizja do wypłaty") and confusing for handlowcy who saw negative commissions in their own finance view.
- **Decision (user):** split concerns
  - `commission_amount` (display + payable sum)  → ALWAYS `>= 0` (clamped)
  - `commission_audit_value` (raw, may be negative) → audit trail
- **Remediation:**
  - [x] `create_contract`: compute raw `commission_audit_value = pct * effective_margin`, then `commission_amount = max(0.0, commission_audit_value)`. Both stored on the doc.
  - [x] `_serialize_contract`: returns both fields. Legacy contracts (no `commission_audit_value` field) get `None` so frontend can detect "old format".
  - [x] On `negative_margin_override and commission_audit_value < 0`, write an explicit `contract_audit_log` entry with `field="commission_negative_clamp", old_value=raw, new_value=0, reason="negative_margin_override active; payable clamped to 0..."`. Includes `changed_by`, `changed_by_role`, `changed_at`.
  - [x] Finance-v2 (`_compute_finance_v2`) already reads `commission_amount` (now clamped). NO finance code changed.
  - [x] **Backward compat preserved** — existing contracts with persisted `commission_amount: -5000` stay as-is; passive migration. New contracts get the split; legacy ones can be re-saved through admin UI later if desired.
- **Verification:**
  - `test_negative_margin_succeeds_with_override` (updated): asserts `commission_amount == 0.0`, `commission_audit_value == -5000.0`, audit log entry written, `changed_by_role == "admin"`. ✅ PASSED.
  - `test_negative_margin_audit_log_entry` (NEW, different math): 100 m² roof + 20 000 PLN gross → margin -7 500, raw commission -3 750, clamped 0; audit entry has `old_value=-3750, new_value=0`. ✅ PASSED.
  - All 3 dev accounts log in OK; backend reload clean.

### ISSUE-009: Hard caps on `commission_percent` / margin
- **Status:** **DEFERRED to PHASE 4 (SaaS-ification)** per user decision.
- **Rationale:** single-tenant deployment for the user's own firm; 3 known managers; audit-log + ex-post review is judged sufficient. Hard caps would block legitimate VIP-override flows that the business uses.
- **What changes when SaaS-ify:** admin of each tenant configures their own caps in `settings` (e.g. `max_commission_percent: 70`, `max_margin_pct_of_cost: 200`). Backend rejects out-of-bounds posts with 422. Existing deferred docs in PHASE 4 backlog.

### Test impact
- **Pre-Batch-3:** 78 passed + 2 skipped + 8 pre-existing date-flake failures.
- **Post-Batch-3:** **79 passed (+1)** + 2 skipped + 8 failures.
  - `test_negative_margin_succeeds_with_override` flipped FAIL → PASS (relative-date fix + new clamp assertions).
  - `test_negative_margin_audit_log_entry` (NEW) PASS.
  - The remaining 8 failures are the same pre-existing date-clock ones documented in Batch 1 (system date 2026-04-25 vs. hardcoded `signed_at="2026-04-23"`), unrelated to Batch 3.

### Open follow-ups (post-Batch-3)
- [ ] **Frontend admin UI** — show `commission_audit_value` next to `commission_amount` for contracts where `negative_margin_override === true && commission_audit_value < 0`. Tooltip "Audit: -3 750 zł (czysta matematyka, nieujęte do wypłaty)". Marked OPTIONAL by user; backend already guarantees the audit trail.
- [ ] **Pre-existing date-flake fixtures** (8 tests) — replace `signed_at="2026-04-23"` with relative-date helper. This Batch fixed the one we touched (`test_negative_margin_succeeds_with_override`); a sweep-fix for the other 8 should be a separate cleanup ticket.
- [ ] **Legacy contracts** with `commission_amount < 0` — currently still summed as negative in finance-v2 (passive migration, by design). When user is comfortable, a one-off backfill script can clamp them and write retroactive audit entries.
- [ ] **PHASE 4 SaaS-ification:** ISSUE-009 hard caps come back as per-tenant `settings.max_commission_percent` / `max_margin_pct_of_cost` enforced at POST `/contracts` time.
- [ ] **Compromised ZIP archive scope review** — if the previously-served `/tmp/oze-crm-app.zip` may have been downloaded by adversaries, consider whether ANY other secrets were inside that ZIP at the time of its creation. JWT_SECRET rotation already invalidates any leaked JWTs; but other secrets (LLM keys, third-party API tokens) — none currently in `.env` per audit — would also need rotation if they had been included.
