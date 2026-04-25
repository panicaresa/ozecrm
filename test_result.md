#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  OZE CRM + Offer Generator Expo app. Phase 1.5 — Quick Commission Calculator
  (widget "Szybki kalkulator prowizji"), Admin editable commission settings,
  and PDF guarantee text fix (remove all PV references).

backend:
  - task: "Settings endpoint supports commission_percent + margin_per_m2"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          SettingsIn model already contains commission_percent (default 50) and margin_per_m2 (default 50).
          GET /api/settings must return these fields (seeded default). PUT /api/settings (admin-only)
          must accept and persist them. Non-admin (manager, handlowiec) must be able to GET settings
          (needed by CommissionCalculator widget on all dashboards) but must receive 403 on PUT.
      - working: true
        agent: "testing"
        comment: |
          Verified via /app/backend_test.py against the public backend URL.
          - GET /api/settings works for admin / manager / handlowiec (200).
          - PUT /api/settings as admin with commission_percent=42.5 and margin_per_m2=75.0 returned 200 and values persisted on subsequent GET. Restored to 50/50 afterwards.
          - PUT /api/settings as manager and handlowiec correctly returns 403.
          - GET/PUT without auth correctly returns 401.

          MIGRATION NOTE (fixed in-place by testing, no code change):
          On the very first run, GET /api/settings returned the doc WITHOUT commission_percent and
          margin_per_m2, because seed_data() in server.py only inserts a new settings doc when one
          does not already exist — it does not migrate/augment an existing doc. So any deployment that
          already had a pre-v1.5 settings/global document in Mongo silently loses the two new fields
          for ALL consumers (widget, frontend, etc.) until someone performs an admin PUT.
          After the admin PUT performed by this test suite, the fields are now present in the stored
          doc (commission_percent=50.0, margin_per_m2=50.0) and every subsequent GET returns them.
          MAIN AGENT should add a small migration step in seed_data (e.g. use $set with
          SettingsIn(...).dict() merged on top of the existing doc, or $setOnInsert-style upsert that
          fills only missing keys) so production DBs upgrade cleanly without requiring a manual PUT.
      - working: true
        agent: "main"
        comment: |
          Implemented the recommended migration: seed_data() now backfills any missing SettingsIn
          keys on the existing settings/global doc with $set. Backend restarted. Future upgrades
          will automatically gain commission_percent and margin_per_m2 without needing an admin PUT.

  - task: "All existing auth + leads + dashboards endpoints remain green"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          No regressions expected on auth/login, /api/auth/me, /api/leads CRUD,
          /api/dashboard/manager, /api/dashboard/rep, /api/rep/location. Re-verify with seeded users.
      - working: true
        agent: "testing"
        comment: |
          All regression endpoints verified:
          - POST /api/auth/login for admin/manager/handlowiec → 200 with correct role.
          - GET /api/auth/me → 200 matching user.
          - Wrong password → 401.
          - GET /api/dashboard/manager (manager) → 200 with kpi, status_breakdown, rep_progress, pins, reps_live.
          - GET /api/dashboard/rep (handlowiec) → 200 with total_leads, signed, meetings, target, percent.
          - GET /api/leads (handlowiec) → 200 array.
          - POST /api/leads (handlowiec) → 200 with id.
          - PATCH /api/leads/{id} to status=umowione → 200.
          - DELETE /api/leads/{id} as handlowiec → 403 (correct — endpoint requires admin/manager).
          - DELETE /api/leads/{id} as admin → 200.
          - PUT /api/rep/location (handlowiec) → 200, and subsequent manager dashboard reps_live contains that user.
          All 26 test assertions pass. No regressions.

  - task: "Finance dashboard endpoint /api/dashboard/finance"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New endpoint GET /api/dashboard/finance. Role-scoped:
            admin      → all signed leads
            manager    → leads assigned to their reps (manager_id match) + owner_manager_id match
            handlowiec → only assigned_to self
          Response includes: period (current month), settings_snapshot, totals_month
          {signed_count, commission_sum, margin_sum, netto_sum, brutto_sum, vat_sum},
          totals_all_time, by_rep, contracts_month, contracts_all.
          Formulas per lead (area=lead.building_area, type=lead.building_type):
            base_rate = base_price_low if area<=200 else base_price_high
            base_netto = area * base_rate
            margin_netto = lead.margin_override (if set) OR area * margin_per_m2
            total_netto = base_netto + margin_netto
            VAT: gospodarczy=23%; mieszkalny ≤300m²=8%; mieszkalny >300m²=mixed 300/area*8%+rest*23%
            total_brutto = total_netto + VAT
            commission = commission_percent% × margin_netto

  - task: "Contracts CRUD + dynamic 14-day commission logic"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New endpoints:
            POST   /api/contracts     (auth required; creates contract for a lead the caller can access)
            GET    /api/contracts     (role-scoped: admin all / manager team / handlowiec self)
            PATCH  /api/contracts/{id}  (admin & manager only; updates total_paid_amount, note, cancelled)
            DELETE /api/contracts/{id}  (admin only)
          When a contract is POSTed, the linked lead's status is flipped to "podpisana".
          commission_amount = (commission_percent/100) * global_margin, snapshotted at creation.
          commission_percent_override is optional on POST; else from settings.commission_percent.

          DYNAMIC 14-day rule (no cron):
          _compute_contract_status(contract) returns:
            status: frozen | partial | payable | cancelled
            commission_total, commission_released, commission_frozen, paid_pct, release_date, days_until_release
          Logic:
            cancelled=True                    → status="cancelled", released=0, frozen=0
            now < signed_at + 14d             → status="frozen", released=0, frozen=full
            now >= signed_at + 14d, credit    → status="payable", released=full
            now >= signed_at + 14d, cash:
              pct = clamp(total_paid/gross, 0, 1)
              released = round(full * pct, 2)
              status = "payable" if pct>=0.9999 else "partial" if pct>0 else "frozen"
      - working: true
        agent: "testing"
        comment: |
          Phase 1.7 Contracts testing COMPLETE — /app/backend_test_phase17.py, all contract-related
          assertions PASS.
          AUTH GATES:
            - POST/GET/PATCH/DELETE /api/contracts without auth → 401 ✅
            - PATCH /api/contracts/{id} as handlowiec → 403 ✅
            - DELETE /api/contracts/{id} as manager → 403 (admin-only) ✅
          CREATE (credit, today):
            - POST /api/contracts as handlowiec for own lead → 200 ✅
            - commission_percent matches settings.commission_percent (=50) ✅
            - commission_amount = round(pct/100 * global_margin, 2) = 6000.0 ✅
            - status == "frozen", commission_frozen == 6000, commission_released == 0 ✅
            - days_until_release == 13 (or 14, accepted) ✅
            - Linked lead flipped to status="podpisana" ✅
          DYNAMIC STATUS — credit signed 15d ago:
            - status == "payable" ✅
            - commission_released == full (pct/100 * 8000 = 4000) ✅
            - commission_frozen == 0 ✅
          CASH PARTIAL — 15d ago, 50% paid:
            - status == "partial", paid_pct == 50.0 ✅
            - commission_total = 10000, released = 5000, frozen = 5000 ✅
            - PATCH total_paid_amount=100000 (admin) → status="payable", paid_pct=100,
              released=full, frozen=0 ✅
          CASH FRESH (within 14d, 50% paid):
            - status == "frozen" even though 50% paid (withdrawal window not yet closed) ✅
          CANCEL:
            - PATCH cancelled=true (admin) → status="cancelled", released=0, frozen=0 ✅
          ROLE SCOPING /api/contracts GET:
            - handlowiec sees only own (rep_id == self) ✅
            - manager contracts ⊇ handlowiec contracts ✅
            - admin contracts ⊇ manager contracts ✅
          Regression sanity: /api/auth/login (all 3 roles), /api/settings (all roles),
          /api/dashboard/manager, /api/dashboard/rep, /api/dashboard/finance (legacy),
          /api/leads GET/POST all still 200 ✅.

  - task: "Calendar /api/calendar/meetings"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          GET /api/calendar/meetings — returns leads with status="umowione" AND meeting_at != null,
          role-scoped. Sorted ascending by meeting_at.
          Lead model extended with meeting_at (ISO datetime string, optional).
          PATCH /api/leads/{id} accepts meeting_at (null clears it).
      - working: true
        agent: "testing"
        comment: |
          GET /api/calendar/meetings — PASS.
            - Unauthenticated → 401 ✅
            - handlowiec → 200, array, includes own umowione+meeting_at lead ✅
            - manager → 200, ⊇ rep (owner of rep) ✅
            - admin → 200, ⊇ manager ✅
            - Response items include lead_id, client_name, phone, address, meeting_at,
              rep_id, rep_name, note ✅
          Lead meeting_at persistence (PATCH /api/leads/{id}):
            - Set meeting_at="2099-06-15T10:30:00Z" + status="umowione" → 200, meeting_at present ✅
            - Re-set meeting_at after clear attempt → 200, meeting_at present ✅

          ⚠ BUG FOUND (belongs to PATCH /api/leads, not /api/calendar/meetings):
          Attempting to CLEAR meeting_at via PATCH /api/leads/{id} with body {"meeting_at": null}
          returns 200 but the field is NOT cleared. Root cause is line ~372 in server.py
          update_lead():
              updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
          This explicitly filters out any None value, so passing null for any nullable field
          (meeting_at, phone, address, assigned_to, latitude, longitude, building_area, etc.)
          silently no-ops instead of setting them to None. This blocks the stated product flow
          "cancel the meeting / un-schedule by sending meeting_at: null".
          Suggested fix: use exclude_unset=True only and drop the `is not None` filter, OR add
          an explicit allow-null list for meeting_at. Example:
              updates = body.dict(exclude_unset=True)
          This bug is NOT a blocker for the calendar endpoint itself (which reads current
          state), but it IS a functional regression vs the review spec point 1
          ("PATCH again to clear: {'meeting_at': null}. Expect 200 and meeting_at null").
          The calendar endpoint, role scoping, auth gating, and sort order are all correct.

  - task: "Finance v2 /api/dashboard/finance-v2 using contracts"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New endpoint GET /api/dashboard/finance-v2 — replaces estimate-based finance with
          contracts-based. Role-scoped.
      - working: true
        agent: "testing"
        comment: |
          Phase 1.7 Finance v2 testing COMPLETE — /app/backend_test_phase17.py, all assertions PASS.
          AUTH:
            - Unauthenticated → 401 ✅
            - handlowiec / manager / admin → 200 ✅
          BUCKETS (using 4 created contracts id_A cancelled, id_B credit+15d, id_C cash+100%, id_D cash fresh):
            - payable_contracts contains id_B and id_C ✅
            - frozen_contracts contains id_D (within 14d) ✅
            - cancelled id_A not in any bucket ✅
          TOTALS:
            - totals_month.commission_payable_sum > 0 ✅
            - totals_month.commission_frozen_sum > 0 ✅
          CONTRACTS_MONTH:
            - Contains id_A (signed today) and id_D (signed today) ✅
          BY_REP:
            - Has handlowiec row with signed_count >= expected ✅
          ROLE SCOPING:
            - manager.contracts_all ⊇ rep.contracts_all ✅
            - admin.contracts_all  ⊇ manager.contracts_all ✅
          Regression: legacy GET /api/dashboard/finance still 200 ✅.
          Returns totals_month / totals_all_time with:
            commission_payable_sum (released), commission_frozen_sum, commission_total_sum,
            margin_sum (sum of global_margin), brutto_sum (sum of gross_amount),
            signed_count.
          Plus frozen_contracts / partial_contracts / payable_contracts buckets, by_rep with
          separate payable and frozen sums, contracts_month, contracts_all.
          All derived fields computed live via _compute_contract_status(contract).

          Requires auth (any role). Returns 401 unauthenticated.
      - working: true
        agent: "testing"
        comment: |
          Verified via /app/backend_test_finance.py — 29/29 assertions PASS.
          AUTH:
            - GET /api/dashboard/finance without Authorization → 401 ✅
            - GET as admin / manager / handlowiec → 200 ✅
          RESPONSE SHAPE:
            - Top-level keys present: period, settings_snapshot, totals_month, totals_all_time,
              by_rep, contracts_month, contracts_all ✅
            - period has ISO month_start (2026-04-01T00:00:00+00:00) and month_end ✅
            - settings_snapshot has commission_percent, margin_per_m2, base_price_low, base_price_high ✅
            - totals_month has numeric signed_count, commission_sum, margin_sum, netto_sum,
              brutto_sum, vat_sum ✅
            - by_rep items have rep_id, rep_name, signed_count, commission_sum, margin_sum, brutto_sum ✅
            - Each contract in contracts_month/contracts_all has id, client_name, area, building_type,
              base_netto, margin_netto, total_netto, vat, vat_label, total_brutto, commission ✅
          ROLE SCOPING:
            - handlowiec only sees leads where assigned_to == their own user id ✅
            - manager.contracts_month ⊇ handlowiec.contracts_month ✅
            - admin.contracts_month ⊇ manager.contracts_month ✅
            - Same superset relations verified for contracts_all ✅
          MATH (verified against live settings values — commission_percent=50, margin_per_m2=100
          currently in DB, base_price_low=275, base_price_high=200, tolerance ±0.01 PLN):
            - Case A mieszkalny 150m² → base_netto=41250, margin_netto=15000, total_netto=56250,
              VAT(8%)=4500, brutto=60750, commission=7500, vat_label="8%" ✅
            - Case B gospodarczy 180m² → base_netto=49500, margin_netto=18000, total_netto=67500,
              VAT(23%)=15525, brutto=83025, commission=9000, vat_label="23%" ✅
            - Case C mieszkalny 250m² → base_rate=base_high=200, base_netto=50000,
              margin_netto=25000, total_netto=75000, VAT(8%)=6000, brutto=81000,
              commission=12500, vat_label="8%" ✅
            - Case D mieszkalny 400m² (mixed VAT) → base_netto=80000, margin_netto=40000,
              total_netto=120000, VAT mixed (300/400*8% + 100/400*23% = 11.75%)=14100,
              brutto=134100, commission=20000, vat_label="Mieszany" ✅
          All 4 test leads deleted by admin afterwards (status=200).
          REGRESSION:
            - GET /api/settings still returns commission_percent, margin_per_m2,
              base_price_low, base_price_high ✅
            - GET /api/dashboard/manager (manager) → 200 ✅
            - GET /api/dashboard/rep (handlowiec) → 200 ✅
          NOTE (non-blocking): margin_per_m2 in live settings is 100.0 (not the default 50.0),
          likely from an earlier admin PUT. Math assertions used live settings values so this
          is not a failure — just a heads-up if the review expected 50.0.


frontend:
  - task: "CommissionCalculator widget on Admin / Manager / Rep dashboards"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/CommissionCalculator.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New widget computes commission per area + building type using commission_percent and
          margin_per_m2 from /api/settings. VAT logic mirrors offerEngine (8% mieszkalny ≤300m²,
          23% gospodarczy, mixed proportional above 300m² for mieszkalny). Shown on
          (admin)/index, (manager)/index, (rep)/index.

  - task: "Admin Settings can edit commission_percent and margin_per_m2"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(admin)/settings.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added new "Kalkulator prowizji handlowca" section with two numeric fields. Values are
          loaded via GET /api/settings and saved via PUT /api/settings.

  - task: "PDF Guarantee text — no PV references"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/lib/offerEngine.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Removed the sentence about photovoltaic warranty. Text now reads exactly:
          "Na wykonane prace montażowe udzielamy 10-letniej gwarancji. Producenci materiałów
          pokryciowych zapewniają gwarancję materiałową do 40 lat." (with <b> around "10-letniej
          gwarancji" and "do 40 lat"). Existing page-break-inside:avoid CSS rules preserved.

  - task: "Contract corrections (additional_costs + admin-only)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Phase 1.8 admin corrections on contracts tested via /app/backend_test_phase18.py.
          All 66 assertions PASS.
          PATCH /api/contracts/{id} with additional_costs + additional_costs_note:
            - admin OK (200); effective_margin = global_margin - additional_costs ✅
            - commission_total = commission_percent/100 * effective_margin (verified 6000→5000) ✅
            - commission_total_original unchanged and equals original commission_amount ✅
            - manager → 403 (admin-only for these fields) ✅
            - handlowiec → 403 ✅
            - additional_costs=-100 → 400 Bad Request ✅
            - additional_costs=0 & note="" → corrections cleared; commission_total reverts ✅
          Dynamic 14d logic WITH corrections (signed 20d ago, credit, gm=10000, pct=50):
            - Initial: status=payable, commission_released=5000 ✅
            - additional_costs=4000 → commission_total=3000, released=3000, original=5000 ✅
            - additional_costs=0 → commission_released back to 5000 ✅
          Finance v2 reflects corrections:
            - GET /api/dashboard/finance-v2 as admin returns corrected contract with
              commission_total reduced (10000-2500 → 3750) and additional_costs=2500 ✅
          PATCH /api/contracts/{id} total_paid_amount (cash contracts):
            - admin → 200 ✅
            - manager (own team rep) → 200 ✅
            - handlowiec → 403 (endpoint requires admin/manager role) ✅
          Cleanup: all test-created contracts, leads, and the temporary user were deleted.

  - task: "GET /api/contracts/{id}"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Phase 1.8 GET /api/contracts/{id} verified (/app/backend_test_phase18.py):
          - admin, manager (owning rep), handlowiec (rep_id==self) → all 200 ✅
          - Response contains all required fields: id, lead_id, client_name, rep_id,
            signed_at, gross_amount, global_margin, commission_percent, commission_amount,
            commission_total, commission_total_original, effective_margin, additional_costs,
            additional_costs_note, commission_released, commission_frozen, paid_pct,
            release_date, days_until_release, status ✅
          - Separate rep (no link to manager) + lead/contract → handlowiec@ GET → 403 ✅
          - GET /api/contracts/nonexistent-xyz → 404 ✅
          Regression: POST /api/auth/login (3 roles), GET /api/auth/me, GET /api/settings
          (3 roles) all still 200 ✅.

  - task: "Phase 1.9 K1 signed_at validation (handlowiec 2d back, admin 90d back, no future >1d)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Phase 1.9 — verified via /app/backend_test_phase19.py.
          POST /api/contracts signed_at validation:
          - handlowiec today → 200 ✅
          - handlowiec yesterday (-1d) → 200 ✅
          - handlowiec -3d → 400 with Polish message "wczorajsza lub dzisiejsza" ✅
          - handlowiec -15d → 400 ✅
          - handlowiec +2d future → 400 with "przyszłości" ✅
          - admin -30d → 200 (admin allowed up to 90) ✅
          - admin -95d → 400 with "90 dni wstecz" ✅

  - task: "Phase 1.9 W2 commission_percent_override forbidden for handlowiec"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          POST /api/contracts with commission_percent_override=99:
          - handlowiec → 403 with Polish "Handlowiec nie może nadpisywać" ✅
          - manager → 200; returned contract.commission_percent=99 ✅
          - admin → 200; returned contract.commission_percent=99 ✅

  - task: "Phase 1.9 K5 Cross-field validation (margin/gross/down_payment/roof/installments/paid)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          POST /api/contracts invalid combinations → all 400 with Polish messages:
          - global_margin=60000 > gross=50000 → 400 "nie może być większa" ✅
          - cash down_payment=55000 > gross=50000 → 400 "większa" ✅
          - down_payment=-100 → 400 ✅
          - roof_area_m2=0 → 400 ✅
          - installments_count=0 → 400 ✅
          PATCH /api/contracts/{id}:
          - total_paid=60000 when gross=50000 (>105%) → 400 ✅
          - total_paid=52000 when gross=50000 (within 5%) → 200 ✅
          - total_paid=-10 → 400 ✅

  - task: "Phase 1.9 K6 Idempotency-Key on POST /api/contracts"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Idempotency-Key header replay protection:
          - POST #1 with Idempotency-Key X → 200 returns contract id=A ✅
          - POST #2 SAME body + SAME key → 200 returns SAME id=A (no duplicate) ✅
          - GET /api/contracts shows exactly ONE contract for that lead_id ✅
          - POST #3 SAME body + DIFFERENT key → creates second contract id=B (B!=A) ✅

  - task: "Phase 1.9 W3 meeting_at validation on PATCH /api/leads"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          PATCH /api/leads/{id} meeting_at validation:
          - "2099-01-01T10:00:00Z" → 400 with "2 lata w przód" ✅
          - "2020-01-01T10:00:00Z" → 400 with "wcześniejszy niż wczoraj" ✅
          - "invalid-date" → 400 with "nieprawidłowy format" ✅
          - <tomorrow ISO> → 200 (value persisted) ✅
          - null → 200 (clearing works, resolves earlier Phase 1.7 bug) ✅

  - task: "Phase 1.9 W9 contract_audit_log endpoint"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          GET /api/contracts/{id}/audit-log verified:
          - After 3 PATCHes (total_paid_amount, additional_costs+note, cancelled) →
            endpoint returns 4 entries (some PATCHes record multiple fields) ✅
          - All required fields present on each entry: id, contract_id, field, old_value,
            new_value, changed_by, changed_by_name, changed_by_role, changed_at ✅
          - additional_costs entry has extra `reason_note` = "test" ✅
          - Entries sorted by changed_at desc; latest entry field="cancelled",
            old_value=false, new_value=true ✅
          - admin → 200; owner handlowiec → 200; manager (team) → 200 ✅
          - unrelated handlowiec → 403; nonexistent contract → 404 ✅

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 9
  run_ui: false

test_plan:
  current_focus:
    - "Sprint 5-pre-quad — Rep tap-to-action sheet (call/KPI/profile) on map markers"
  stuck_tasks:
    - "Faza 2.0 GET /api/tracking/track/{rep_id} role-scoped"
  test_all: false
  test_priority: "high_first"

# --- Sprint 5-pre-quad (2026-04-25 13:00) — Rep tap-to-action ---
sprint_5_pre_quad:
  - task: "Backend: phone+email in /dashboard/manager reps_live[]"
    implemented: true
    working: true
    file: "/app/backend/server.py + tests"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added "phone" and "email" keys to the dict appended to reps_live[].
          The pre-existing find query already used an exclusion projection
          ({"_id": 0, "password_hash": 0}), so both fields were already in
          the user doc — no projection change needed.
          New test in TestRepsLiveContact verifies the keys are always
          present (value can be None for users without phone) and that
          email is a parseable address.

  - task: "Backend: demo seed phones for all 4 demo reps"
    implemented: true
    working: true
    file: "/app/backend/server.py upsert_user"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          upsert_user gained an optional `phone` parameter; on existing-user
          path, phone is backfilled if missing (idempotent). Manager and
          all 4 handlowcy now have +48 500 100 2XX numbers — makes the
          "Zadzwoń" tile demonstrable in preview without a real device.

  - task: "Frontend: RepActionSheet component (new)"
    implemented: true
    working: true
    file: "/app/frontend/src/components/RepActionSheet.tsx (new)"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          New component (~430 lines) modeled after LeadActionSheet pattern:
          Modal + Pressable backdrop + slide animation on native, fade on
          web. Sections: identity (avatar+name+online dot+battery+work-time),
          phone tile (tap → tel: dialer via Linking.openURL; gracefully
          shows "Brak numeru telefonu" when phone is missing), KPI tiles
          (Umowy / Leady / Postęp), primary "Zobacz pełny profil" button
          (router.push to /(scope)/rep/[id]), cancel.
          Visual smoke confirmed via 2 screenshots (with phone filled vs
          without phone — both render correctly).

  - task: "Frontend: LeadMap.native + LeadMap.tsx (web fallback) — onRepActionRequested prop"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/LeadMap.native.tsx + LeadMap.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New optional prop `onRepActionRequested?: (rep: RepPin) => void`
          fires alongside the existing `onSelectRep`. Native: Marker.onPress
          calls both. Web: rep row TouchableOpacity calls both. ZERO
          regression on the existing read-only callout / select logic —
          parents that don't pass the new prop see the same behaviour as
          before.

  - task: "Frontend: Manager dashboard + Map-fullscreen integration"
    implemented: true
    working: true
    file: "/app/frontend/app/(manager)/index.tsx + /app/frontend/app/map-fullscreen.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Both screens now hold an `actionSheetRep` state, pass
          onRepActionRequested to LeadMap, and render <RepActionSheet />
          at end. Composer merges marker data (phone/email/battery/active)
          with KPI from rep_progress[] (signed/total_leads/target/percent).
          Map-fullscreen infers scope from auth user role
          (admin → admin, anything else → manager). Visual smoke confirmed
          on (manager)/index.tsx — sheet opens with phone tile populated.

# --- Sprint 5-pre-tris (2026-04-25 12:00) — bugfixes from user preview testing ---
sprint_5_pre_tris:
  - task: "Fix map-fullscreen styling — chips ballooning, map small"
    implemented: true
    working: true
    file: "/app/frontend/app/map-fullscreen.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          ROOT CAUSE: horizontal ScrollView without explicit container height
          inherited flex:1 from its SafeAreaView parent and ballooned to ~40%
          of the viewport. Outer ScrollView wrapping the map then split the
          remaining space, leaving the map at ~40%.
          
          FIX: 
          a) Wrapped the chips ScrollView in a fixed-height (56px) View
             ("statusFilterWrapper") with flexShrink:0 so it cannot grow.
          b) Each chip got fixed height:36 + paddingVertical:0.
          c) Dropped the outer ScrollView wrap around <LeadMap /> and
             replaced with a flex:1 mapContainer View. The map's own
             internal scroll handles list overflow on web.
          d) Computed mapHeight = window.height - 56 - 56 - safeArea
             insets (top+bottom). Min clamp 320. useSafeAreaInsets()
             added.
          
          Visual smoke confirmed via two screenshots: header ~56px,
          chips strip ~56px (single row), map fills the remaining ~720px+.

  - task: "Fix auto-status not visible in UI — frontend refetch on focus"
    implemented: true
    working: true
    file: "Multiple files (LeadDetailScreen + my-leads + (manager)/leads + (rep)/index)"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          ROOT CAUSE: Backend was 100% correct — logs (verified) show
          "Lead <id> status auto-changed: umowione → podpisana" entries
          for every POST /contracts. The issue was purely frontend:
          screens used useEffect with [load] dependency (runs once on
          mount only) and never re-fetched when navigating BACK from
          /add-contract. The user saw stale "umowione" status because
          the lead detail / leads list screens cached the pre-contract
          response.
          
          FIX: Added useFocusEffect (from "expo-router") to:
            - /app/frontend/src/components/LeadDetailScreen.tsx
            - /app/frontend/app/(rep)/my-leads.tsx
            - /app/frontend/app/(manager)/leads.tsx
            - /app/frontend/app/(rep)/index.tsx (rep dashboard summary)
          
          Each refetches its data 50ms after the screen receives focus,
          regardless of whether the user navigated forward or back.
          The 50ms delay is intentional — avoids racing the initial-mount
          useEffect on first paint.
          
          Backend logs confirm auto-status was already firing before this
          fix (timestamps 11:30, 11:52, 12:05 — all post-Sprint 5-pre-bis
          deploy). No backend changes were needed.


# --- Sprint 5-pre-bis (2026-04-25) — UX polish before APK MVP ---
sprint_5_pre_bis:
  - task: "ISSUE-UX-001 — Auto lead.status='podpisana' on contract create"
    implemented: true
    working: true
    file: "/app/backend/server.py + tests"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Replaced the unconditional update with: read current lead.status,
          if !=podpisana update + insert lead_audit_log entry + set
          status_auto_changed_at and status_auto_changed_reason metadata.
          Wrapped in try/except so contract creation never fails because
          of audit/update issues. Idempotent replay returns early before
          this branch (verified by test).
          3 new tests in TestAutoStatusOnContract: passes status update,
          no double-audit on second contract (already-podpisana skip),
          no double-audit on idempotent replay.
      - working: true
        agent: "testing"
        comment: |
          Sprint 5-pre-bis ISSUE-UX-001 — VERIFIED end-to-end.
          1) pytest tests/test_oze_crm_api.py: **97 passed, 2 skipped, 0 failed**
             (all 3 TestAutoStatusOnContract tests green:
              test_lead_status_changes_to_podpisana_on_contract_create,
              test_lead_already_podpisana_no_extra_audit_entry,
              test_idempotent_replay_does_not_double_audit).
          2) Manual smoke (script: /app/backend_test_sprint5_pre_bis.py,
             12/12 PASS) hitting the public BASE URL
             https://renewable-sales-hub.preview.emergentagent.com/api:
             a) login handlowiec@test.com → 200 ✅
             b) POST /api/leads with status=umowione + photo_base64 + GPS
                near 53.5/18.0 + meeting_at → 200 (status echoed "umowione") ✅
             c) POST /api/contracts (cash, signed_at=yesterday, valid finance
                fields) → 200, contract_id returned ✅
                Backend log confirms: "Lead <id> status auto-changed:
                umowione → podpisana".
             d) Manager GET /api/leads → lead now has:
                  status="podpisana" ✅
                  status_auto_changed_reason="contract_created" ✅
                  status_auto_changed_at="2026-04-25T11:05:11.905000" (non-null ISO) ✅
             e) Second POST /api/contracts with NEW Idempotency-Key on the
                SAME lead → 200 returns a DIFFERENT contract id, lead.status
                STILL "podpisana", and status_auto_changed_at unchanged (no
                second audit entry) ✅
             f) Idempotent replay: POST /api/contracts twice with the SAME
                Idempotency-Key → both 200, both return the SAME contract_id
                (e0a7b170-…). No duplicate created. ✅
          3) Regression sanity for Sprint 5-pre:
                PUT /api/rep/location/batch with 3 distinct points →
                  200 {"ok":true,"track_len":4,"appended":3,"received":3} ✅
                DELETE /api/rep/location → 200 ✅
          No unexpected behaviour. No 4xx/5xx outside the explicitly
          negative tests. Backend logs clean.

  - task: "ISSUE-UX-002 — Full-screen map view (/map-fullscreen)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/map-fullscreen.tsx (new) + manager dashboard maximize button + _layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New route /map-fullscreen reuses LeadMap with mapHeight=screen-200
          (large), refetches /dashboard/manager + /leads independently.
          Status filter chips persist via params.filter_status query.
          Hidden header (Stack.Screen options), animated slide_from_right.
          Bounces handlowiec back to /(rep) (RBAC — server enforces too).
          Manager dashboard adds maximize-2 icon button next to "Lead Map"
          title (testID="map-expand"). Visual smoke: confirmed via screenshot.

  - task: "ISSUE-UX-003 — CommissionCalculator collapsed by default"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/CommissionCalculator.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Single line change: useState(true) → useState(false). Existing
          tap-header-to-toggle wiring is reused. Visual smoke confirmed
          via screenshot — manager dashboard now shows just the calc
          header at bottom with chevron-down.

  - task: "ISSUE-UX-004 — Cele i postęp max 5 + expand"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(manager)/index.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          rep_progress now sorts by signed DESC then percent DESC, slices to
          5 by default. "Pokaż wszystkich (N więcej)" / "Zwiń" toggle inline.
          New testIDs: cele-expand, cele-collapse. Style additions: expandRow,
          expandText. Visual smoke confirmed: 6 reps total → "Pokaż wszystkich (1 więcej)" shown.

  - task: "ISSUE-UX-005 — Dashboard reorder (LeadMap top, Calc bottom)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(manager)/index.tsx + (admin)/index.tsx (rep already had calc at end)"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Manager: KPI → LeadMap (with maximize) → rep callout → drilldown
          → DailyReport → Search → Cele i postęp → Donut → Top 3 → buttons
          → CommissionCalculator (was: KPI → Calc → DailyReport → Search →
          Cele → Donut → Top 3 → LeadMap → callout → drilldown → buttons).
          Admin: DailyReport → tiles → Calc (was: Calc → DailyReport → tiles).
          Rep: already had calc at end; just inherits collapsed default.
          Visual smoke confirmed via 2 screenshots (top + bottom of dashboard).


# --- Sprint 5-pre (2026-04-25) — Critical pre-APK MVP fixes ---
sprint_5_pre:
  - task: "Sprint 5-pre — Task 1: Photo compression on online POST /leads (DONE in prior session)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(rep)/add-lead.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Previous-session fix. compressPhoto() called before online POST /leads
          and timeout extended to 30s. Verified by tsc --noEmit and bundler.
          Not affected by Sprint 5-pre Task 2/3 work.

  - task: "Sprint 5-pre — Task 2: resetStaleSyncing in offline queue (ISSUE-014)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/lib/offlineQueue.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added resetStaleSyncing(maxAgeMs = 5 * 60_000) to /app/frontend/src/lib/offlineQueue.ts.
          For each op with status="syncing" and last_attempt_at older than 5 min (or unparsable
          timestamp / no timestamp), the function flips it back to "pending" and stamps a
          last_error="auto-reset: stuck in syncing > 5min" so the user gets visibility on the
          /sync-status screen.
          Wired into startAutoSync() to fire ONCE on app boot AND on every 15s tick (cheap —
          the function early-returns when there are no syncing ops). This eliminates the
          deadlock where a force-killed/crashed JS bundle leaves an op forever stuck and the
          rest of the queue is silently skipped (because of "if op.status !== 'pending' continue"
          guard in syncNow()).
          Returns count of reset ops; logs "offlineQueue: resetStaleSyncing reset N stuck op(s)"
          so it's traceable in dev console / logcat.

  - task: "Sprint 5-pre — Task 3: PUT /api/rep/location/batch (ISSUE-017)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + /app/frontend/src/lib/backgroundTracking.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Backend (/app/backend/server.py):
            - New models RepLocationBatchPoint + RepLocationBatchIn (list of points with
              optional ts ISO timestamp).
            - New endpoint PUT /api/rep/location/batch (rate-limited 60/min per token,
              same as single-point sibling). Loops over all incoming points applying the
              SAME haversine dedup rule (>=10m), MAX_TRACK_POINTS=500 cap, midnight
              session reset, and session_distance accumulator that the single-point
              endpoint uses. Single Mongo update_one + single WS broadcast at the end.
              Cap: max 100 points per batch (returns 400 if exceeded).
              Empty batch: 400 "Batch musi zawierać co najmniej 1 punkt".
            - Backward compat: original PUT /api/rep/location remains untouched and
              functional in parallel (verified by test_single_point_endpoint_still_works).
          Frontend (/app/frontend/src/lib/backgroundTracking.ts):
            - TaskManager.defineTask now maps the FULL `locations` array from expo-location
              into a `points` payload (latitude, longitude, accuracy, ts derived from
              loc.timestamp) and PUTs to /api/rep/location/batch instead of just
              dropping the most recent point at /api/rep/location.
            - Fixes manager polyline gaps caused by OS-coalesced background updates.
          Tests:
            - 7 new tests in TestRepLocationBatch class:
              1. test_batch_requires_auth (anon → 401)
              2. test_batch_empty_400 (empty list → 400)
              3. test_batch_appends_all_distinct_points (5 distinct points → all appended)
              4. test_batch_dedupes_near_identical (4 points within ~0.5m → all but one
                 deduped by haversine)
              5. test_batch_over_cap_400 (101 points → 400 with "100" in error)
              6. test_single_point_endpoint_still_works (backward compat smoke)
              7. test_dashboard_manager_picks_up_batch_position (manager reps_live[].lat
                 reflects the LAST batch point)
          Verification: 94 passed, 2 skipped, 0 failed (was 79/8/2).

  - task: "Sprint 5-pre — date-flake test cleanup (yesterday_iso helper)"
    implemented: true
    working: true
    file: "/app/backend/tests/test_oze_crm_api.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added yesterday_iso() and today_iso() helpers at top of the file.
          Replaced all 10 hardcoded `"signed_at": "2026-04-23"` literals with calls to
          yesterday_iso() (10 occurrences across TestContractSignedEvent,
          TestCommissionFraudPrevention, TestDailyReport).
          Also updated 2 stale broadcast-payload tests that were checking for fields the
          Batch 2 audit removed (PII filter — broadcaster ships THIN payload only):
          - test_contract_post_broadcasts_contract_signed: now asserts thin payload
            (contract_id, is_high_margin, signed_at) and explicitly verifies that
            client_name / gross_amount / commission_amount are NOT present.
          - test_high_margin_flag_in_broadcast: same — drops margin_pct_of_cost and
            computed_margin asserts (those are server-internal only now).
          Result: from 79 passed / 8 failed / 2 skipped → 94 passed / 0 failed / 2 skipped.


# --- Sprint 4 (2026-04-24) ---
sprint_4:
  - task: "Sprint 4 — Rep activity tracking (backend)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + tests"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - Added _bump_last_action(user) helper — fire-and-forget write of
            users.last_action_at for handlowiec role only; silently swallows
            DB errors so core business logic is never broken.
          - Hooked into: POST /leads, PATCH /leads/{id}, POST /contracts,
            PUT /rep/location.
          - Added _rep_activity_status(last_action_at, now) → (status, minutes).
            Rules: active <30min today, idle >=30min same UTC day, offline
            otherwise (no activity today / never).
          - New GET /api/rep-activity (manager+admin; handlowiec → 403).
            Manager scope = own team, admin = all handlowcy. Returns sorted
            list (active first, then idle, then offline).
          - Enriched /dashboard/manager.reps_live[] with activity_status +
            activity_minutes_ago.
          - Tests: 9 new in TestRepActivity class (active/idle/offline/never,
            manager scope, admin scope, handlowiec 403, bump-on-lead-create,
            dashboard embedding). 83/83 pass + 1 skipped.
  - task: "Sprint 4 — useRepActivity hook + Manager dashboard integration"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/lib/useRepActivity.ts + /app/frontend/app/(manager)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - New hook: poll /api/rep-activity every 60s (configurable);
            exports getActivityColor() + getActivityLabel() helpers.
          - theme.ts: added colours activeStatus (#22C55E), idleStatus
            (#EAB308), offlineStatus (#94A3B8) — distinct from brand
            secondary / lead-status palette.
          - Manager dashboard: activity status dot next to rep name in the
            rep-callout card + text "Aktywny 10 min temu" / "Bezczynny N min
            temu" / "Offline". Uses useRepActivity data as primary source
            with fallback to reps_live.activity_status (both are kept in
            sync by the 60s poll).
  - task: "Sprint 4 — Manager Dashboard: status filter chips above LeadMap"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(manager)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Horizontal ScrollView of 6 chips: Wszystkie / Nowy / Umówione /
          Decyzja / Podpisana / Nie zainteresowany — each with live count
          and coloured dot matching the existing status palette. Tap wires
          into the existing `filterStatus` state which in turn drives
          `filteredPins` (LeadMap). Tap "Wszystkie" → reset.
          Verified: chip "Decyzja (4)" → map narrows to 4 pins + rep list
          filters accordingly.
  - task: "Sprint 4 cosmetic — `vs 2 dni temu` in yesterday mode"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DailyReportWidget.tsx"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          DailyReportWidget now reads: {period === "today" ? "vs Wczoraj"
          : "vs 2 dni temu"} — removes the grammatical mismatch when the
          user toggles Wczoraj. Verified in UI.
  - task: "Sprint 4 cosmetic — SecureStore web fallback via getToken()"
    implemented: true
    working: "NA"
    file: "src/lib/useRepLocationsWS.ts + useAppEventsWS.ts + backgroundTracking.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Replaced direct `SecureStore.getItemAsync("oze_token")` with the
          existing `getToken()` helper (api.ts) which is already web-safe
          (AsyncStorage on web, SecureStore on native). This removes the
          red dev overlay "ExpoSecureStore.default.getValueWithKeyAsync is
          not a function" that was blocking screenshots after login on web.
  - task: "Sprint 4 cosmetic — DELETE /api/admin/cleanup-test-data"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + /app/frontend/app/(admin)/settings.tsx"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New admin-only endpoint — deletes users whose `name` starts with
          TEST_ / test_ / xxx (case-insensitive) AND their leads/contracts
          and rep_locations. Protects the 3 dev seed emails by email
          whitelist. UI button in Admin Settings under a new "Narzędzia"
          section, with a two-step Alert.alert confirmation.
  - task: "Sprint 4 cosmetic — shadow* → boxShadow"
    implemented: true
    working: "NA"
    file: "LeadCard.tsx + ConfettiHost.tsx + (rep)/index.tsx"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Replaced all shadowColor/shadowOpacity/shadowRadius/shadowOffset
          quadruples with a single `boxShadow: "0px Xpx Ypx rgba(...)"` in
          our own components. Retained `elevation` for Android. Metro
          warnings count dropped from ~18 per render to 0 from our code
          (only library code may still log warnings — FlatList or
          Swipeable imports).

# --- Sprint 3.5d (micro-sprint) 2026-04-24 ---
sprint_35d_micro:
  - task: "Sprint 3.5d — LeadActionSheet component"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/LeadActionSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New reusable bottom sheet shown ONLY from DrillDownableSection modal
          rows. 4 options:
            - Primary "Zobacz szczegóły" (large button, colors.primary)
            - "Zadzwoń" (tel: linking — disabled when no phone)
            - "Mapy" (platform-aware: ios maps:, android google.navigation:,
              web maps.google.com — disabled when no lat/lng; shows
              "BRAK GPS" hint)
            - "Handlowiec" (navigate to rep profile — disabled when
              onViewRep is not provided)
          Backdrop tap or "Anuluj" closes sheet. Android back button closes
          via onRequestClose. Uses SafeAreaView bottom edge + slide
          animation (native) / fade (web).
  - task: "Sprint 3.5d — DrillDownableSection: opt-in action sheet"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DrillDownableSection.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added 3 new optional props: useActionSheet (default false — backward
          compat), scope, repProfileHrefBuilder. When useActionSheet=true,
          tapping a row INSIDE THE FULL-LIST MODAL stores it in state and
          opens LeadActionSheet. Inline preview rows (above the modal) keep
          instant-navigate behaviour — action sheet is research-mode only.
          Actions:
            - "Zobacz szczegóły" → close both sheets + onItemPress(item)
            - Call / Map → close action sheet only (drill modal stays open)
            - "Handlowiec" → close both + router.push(
              repProfileHrefBuilder(item))
            - "Anuluj" / backdrop → close action sheet only
  - task: "Sprint 3.5d — DailyReportWidget: activate useActionSheet on lead drills"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DailyReportWidget.tsx + /app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Enabled useActionSheet + scope + repProfileHrefBuilder on TWO drill
          sections that represent individual leads:
            - Najbliższe spotkania (meetings_tomorrow)
            - Decyzja klienta (hot_leads)
          NOT enabled for group chips:
            - Nowe leady wg handlowca → still navigates to
              /(manager)/leads with filter
            - Nieaktywni → still navigates to rep profile
          Backend: enriched meetings_tomorrow.list + hot_leads.list items
          with phone, address, latitude, longitude, status so that the
          LeadActionSheet Call + Map tiles can light up. Existing 74/74
          backend tests remain green (schema additions only).
          Verified on web:
            - Manager → Daily Report → expand → "Pokaż wszystkie (4)"
              on Gorące leady → drill modal opens (4 rows)
            - Tap a lead row → ActionSheet slides up OVER drill modal
              with Nowak Jadwiga header, address, rep_name, primary
              "Zobacz szczegóły" button + 3 action tiles
              (Zadzwoń / Mapy BRAK GPS / Handlowiec)
            - Tap Cancel → action sheet closes, drill modal stays open ✅
            - Tap "Zobacz szczegóły" → both close, navigate to
              /lead/656f1ebe-... ✅
            - Regression: handlowiec → Moje leady → tap MAREK SSFS →
              instant nav to /lead/d08f33e1-... (NO action sheet) ✅

# --- Sprint 3.5c (micro-sprint) 2026-04-24 ---
sprint_35c_micro:
  - task: "Sprint 3.5c — GestureHandlerRootView wrapper (crash fix)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          User reported crash "PanGestureHandler must be used as a descendant
          of GestureHandlerRootView" after tapping the "Jan: 1" chip in Daily
          Report and navigating to Manager Leads.
          Fix: wrapped the entire Stack in <GestureHandlerRootView style={{flex:1}}>
          as the outermost provider (before SafeAreaProvider, AuthProvider).
          Verified: handlowiec → Moje leady renders Swipeable list without crash;
          admin → Daily Report drill-down modal (Swipeable) works normally.
  - task: "Sprint 3.5c — Backend: skip 999-day inactive_rep alerts"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + /app/backend/tests/test_oze_crm_api.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Never-worked reps (no leads ever, last_active_days_ago == 999) no
          longer emit `inactive_rep` warning alerts — they are NEW hires, not
          neglected. They still show up in team_activity.inactive_list for
          head-count visibility. Added test_daily_report_skips_999_days_alerts
          that inserts a fresh handlowiec directly in Mongo, verifies they
          are in inactive_list but NOT in alerts. 74/74 pass + 1 skipped.
  - task: "Sprint 3.5c — Admin rep profile route + shared RepProfileScreen"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/RepProfileScreen.tsx + /app/frontend/app/(admin)/rep/[id].tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Refactored: moved the 389-line body of (manager)/rep/[id].tsx into
          a shared /src/components/RepProfileScreen.tsx with a scope prop
          ("admin" | "manager"). Both route files are now 5-line wrappers.
          Admin scope adds:
            - breadcrumb "CAŁA FIRMA · MANAGER: <name>" above the title
            - ADMIN badge (shield icon) in the top-right of the header
            - a tap-able "Manager" info card above the hero card (drills
              deeper into that manager's own profile)
          Updated DailyReportWidget.repProfileHref → admin routes to
          /(admin)/rep/<id>, manager keeps /(manager)/rep/<id>.
          Manually verified: admin → Daily Report → inactive-chip tap →
          /rep/<id> opens with breadcrumb, Admin badge, and manager card.
          Manager → same tap → unchanged behaviour.

# --- Sprint 3.5b: DrillDownable pattern + Calc fix (2026-04-24) ---
sprint_35b:
  - task: "Sprint 3.5b — CommissionCalculator: gross-price input aligned with Sprint 4.5"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/CommissionCalculator.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          BREAKING change in input model. Previously user typed "marża" and
          system derived "totalNetto = baseNetto + marża" which diverged from
          POST /contracts (Sprint 4.5) formula.
          NOW: user enters `area (m²)` + `gross price (PLN netto)`. The widget
          computes `firm_cost = area * base_price_tier` and `margin = gross − firm_cost`
          — identical logic to backend _compute_cost_and_margin.
          New "SUGEROWANA" button fills gross = koszt * 1.3 as a starting point.
          Removed: marginOverride / marginTouched / resetMargin state.
          Added: red warning block when margin is negative ("Umowa zablokowana
          dla handlowca; manager/admin może nadpisać").
          Commission = commission_percent × max(0, margin). If margin ≤ 0,
          commission = 0 (matches backend).
  - task: "Sprint 3.5b — Remove margin_per_m2 from admin settings UI"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(admin)/settings.tsx and /app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - Removed the "Marża na m²" input from Admin Settings; replaced the
            row layout with a single "Prowizja (% marży)" field plus a hint
            explaining that margin is auto-computed from cost tiers (Sprint 4.5).
          - Backend: marked SettingsIn.margin_per_m2 as DEPRECATED in a comment;
            kept the field in the schema for backward compat with historical
            reads and /api/dashboard/finance (no UI, no new data paths).
  - task: "Sprint 3.5b — Backend: rep_id + leads drill-down enrichment in /reports/daily"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py + /app/backend/tests/test_oze_crm_api.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - meetings_tomorrow.list items now include `rep_id`.
          - hot_leads.list items now include `rep_id`, `phone`, `address`
            (used for the drill-down modal full-row renderer).
          - new_leads_added.by_rep changed from `{rep_name, count}` to
            `[{rep_id, rep_name, count, leads: [{id, client_name, created_at}]}]`
            so the frontend can either navigate with ?rep_id=... or render
            per-rep lead detail in a modal.
          - Added a new pytest `test_daily_report_includes_drill_down_data`
            asserting these fields exist on every list entry.
          - 73/73 tests pass + 1 skipped.
  - task: "Sprint 3.5b — Generic DrillDownableSection<T> component"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DrillDownableSection.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New reusable pattern (third after FilterableList + useAppEventsWS).
          - Generic `<T extends DrillDownItem>` with React.memo cast.
          - Props: title, icon, iconColor, items, renderItemPreview,
            renderItemFull (optional), onItemPress, maxInline (default 3),
            emptyCopy, modalTitle, layout ("list" | "chips"), testID.
          - Inline preview: up to maxInline items + "Pokaż wszystkie (N)"
            primary button (or "+N" overflow chip for the chips layout).
          - Tap on any row or chip → onItemPress(item) for navigation.
          - Modal: bottom-sheet with backdrop (rgba 0.55), SafeAreaView,
            slide animation on native / fade on web, scrollable list,
            tap on item closes modal and then navigates.
          - Close via X button (top-right), "Zamknij" button (bottom) or
            Android hardware back (onRequestClose).
          - Uses theme tokens only (colors/radius/spacing); zero hardcoded
            colors.
  - task: "Sprint 3.5b — Integrate drill-downs in DailyReportWidget"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DailyReportWidget.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - Imported useRouter (expo-router) and useAuth; wired role-aware
            navigation helpers leadDetailHref, repProfileHref,
            managerLeadsWithFilter. Admin + manager currently share the
            manager routes (Sprint 3.5c TODO: dedicated admin rep profile).
          - Pipeline: swapped the 3 static lists for <DrillDownableSection>:
              • Najbliższe spotkania (icon=calendar) → router.push(lead detail)
              • Decyzja klienta (icon=zap) → router.push(lead detail)
              • Nowe leady wg handlowca (chips layout) → router.push(
                /(manager)/leads?rep_id=<id>&created_today=1)
          - Team: Top 3 rows are now Pressable → router.push(rep profile) with
            chevron-right affordance. Nieaktywni uses DrillDownableSection
            with chips layout; filters out reps with last_active_days_ago ≥ 999
            (they're "never active", not "inactive").
          - Verified visually on manager dashboard:
              • calc 300 m² + 75 000 PLN → koszt 60 000, marża 15 000,
                prowizja 7500 (exact Sprint 4.5 numbers).
              • calc 300 m² + 50 000 PLN → red "UMOWA ZABLOKOWANA" warning,
                prowizja 0.
              • Daily widget collapsed → expanded.
              • "Pokaż wszystkie (4)" on Gorące leady → modal with full list
                + "Zamknij" CTA.
              • chip "Jan: 1" on Nowe leady wg handlowca → navigates to
                /leads?rep_id=<id>&created_today=1 with drill banner +
                pre-filtered list (1 of 26 positions).
  - task: "Sprint 3.5b — Manager Leads: read drill-down URL params"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(manager)/leads.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - Added useLocalSearchParams read of `rep_id` + `created_today=1`.
          - When active, pre-filters the leads array passed to FilterableList
            (source filter, runs before FilterableList's own primary/secondary
            filters and search).
          - Shows a blue drill-down banner at top ("Filtr drill-down:
            handlowiec <name> · dodane dziś") with a round X button to clear
            the filter + drop the URL params via router.setParams.
          - Empty-state copy tailored when drill is active.

# --- Sprint 3.5: Daily Report Widget (2026-04-24) ---
frontend_sprint35:
  - task: "Sprint 3.5 — DailyReportWidget component (collapsed by default)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/DailyReportWidget.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New file: /app/frontend/src/components/DailyReportWidget.tsx.
          Fetches GET /api/reports/daily?period=today|yesterday.
          States:
            - Collapsed by default: single header row with icon + "Raport dzienny"
              + period date + alert pill (count) + chevron-down; mini-metrics row
              shows 3 key figures (Umowy count / Marża łączna / Lider top-rep).
            - Expanded (on tap): period toggle (Dziś / Wczoraj), manual refresh
              button with last-refreshed HH:MM, and 3 colored blocks:
                • Block A "Pieniądze" — contracts count, total_margin (green),
                  total_gross, commission, avg_gross, vs Wczoraj delta with
                  arrow, vs Śr. 7 dni %-change, micro-alerts for cancelled /
                  negative-margin contracts
                • Block B "Pipeline" — meetings_tomorrow, hot_leads (decyzja),
                  new_leads_added with per-rep chips; lists up to 3 entries
                  with "+N więcej" overflow
                • Block C "Zespół" — total/active/inactive counters, Top 3 reps
                  with medal, inactive >3d chips in red
            - Admin-only extra block "Managerowie" (per_manager_breakdown) —
              renders only if the API returns that key.
            - Alerts block at the bottom, grouped criticals first then warnings.
          Silent auto-refresh every 60s (configurable via prop refreshIntervalMs).
          Graceful loading + error + null-data states; keeps design-system
          tokens from /app/frontend/src/theme.ts (colors/radius/spacing).
          No shadows — uses paper + border to match Manager Dashboard and
          FinanceScreen.

  - task: "Sprint 3.5 — Integration into Manager dashboard"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(manager)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Imported DailyReportWidget and inserted directly after the
          CommissionCalculator section. testID="manager-daily-report".
          Screenshot verified on web viewport:
            - Collapsed header + mini metrics render correctly.
            - Tapping header expands to 3 blocks (Pieniądze / Pipeline /
              Zespół) and the Alerts block. Per-manager block is hidden
              (correct — manager scope).
            - Period toggle (Dziś/Wczoraj) switches data (yesterday shows
              0 umów / 0,00 zł for empty day as expected).

  - task: "Sprint 3.5 — Integration into Admin dashboard"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(admin)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Imported DailyReportWidget and inserted directly after the
          CommissionCalculator on the admin home. testID="admin-daily-report".
          Screenshot verified on web viewport:
            - Scope name is the firm name (from settings.company_name).
            - Contracts/margin/commission aggregates computed firm-wide.
            - Per-manager breakdown section ("Managerowie") renders with
              reps_count / active_reps / contracts_today / margin_today.
            - Alerts count badge reflects firm-wide inactive reps + any
              negative-margin contracts.

# --- Mini-sprint + Phase 2.0 testing results (appended 2026-04-22) ---
# See agent_communication below for full report.
# Added tasks:
backend_phase20:
  - task: "Mini-sprint Y1: finance-v2 excludes cancelled from aggregates"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Verified via /app/backend_test_phase20.py.
          Created 2 credit contracts today (A: gross=100000 margin=20000,
          B: gross=50000 margin=10000). Baseline finance-v2 totals_month:
          brutto=209990 margin=42000 frozen=15000 signed=3 cancelled=0.
          PATCH contract_A cancelled=true (admin) → 200, status="cancelled".
          After cancel totals_month:
          brutto=109990 (−100000) ✅
          margin=22000 (−20000) ✅
          commission_frozen=5000 (−10000) ✅
          commission_payable unchanged (A was frozen, not payable) ✅
          signed_count=2 (−1) ✅
          cancelled_count=1 (+1) ✅
          `cancelled_contracts` array present and contains A ✅
          A removed from frozen/partial/payable buckets ✅

  - task: "Mini-sprint C1: cancelled_contracts bucket visibility"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          After cancelling contract_A:
          - handlowiec (owner of A) GET /api/dashboard/finance-v2 →
            cancelled_contracts contains A ✅
          - manager (of handlowiec) GET → cancelled_contracts contains A ✅
          - Admin sees it too (already covered in Y1) ✅
          - A is NOT in frozen/partial/payable for any role ✅

  - task: "Faza 2.0 rep_locations polyline track (haversine dedupe + MAX 500 cap)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          PUT /api/rep/location as handlowiec:
          - point (54.370, 18.630) → 200 {track_len: N>=1} ✅
          - near-identical point (<1m) → DEDUPED, track_len unchanged ✅
          - point with 0.01 lat delta (>>10m) → APPENDED (track_len +1) ✅
          - 500 distinct points with 0.001 lat increments → track_len
            CAPPED at MAX_TRACK_POINTS=500 ✅ (took ~28s over 500 REST calls)
          DELETE /api/rep/location → 200; rep_locations.is_active=false
            (soft-stop, not deleted) ✅ (verified via admin
            /api/tracking/track after the bug below was hot-fixed — see
            NOTE in agent_communication)

  - task: "Faza 2.0 GET /api/tracking/track/{rep_id} role-scoped"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
      - working: false
        agent: "testing"
        comment: |
          BUG: GET /api/tracking/track/{rep_id} returns 404 "Not Found" for
          ALL callers (admin/manager/handlowiec/self/other). Root cause:
          the route decorator `@api.get("/tracking/track/{rep_id}")` is
          defined at line ~1801 in /app/backend/server.py, but
          `app.include_router(api)` is called earlier at line ~1645.
          FastAPI's `include_router` snapshots the router's routes at the
          time of the call, so routes added to `api` AFTER that call are
          NEVER mounted on the app.
          PROOF: /openapi.json contains 0 paths matching "tracking".
          FIX (minor, for main agent): either
            (a) move the `@api.get("/tracking/track/{rep_id}")` block and
                the WebSocket / broadcaster code to BEFORE
                `app.include_router(api)` (line 1645), or
            (b) move `app.include_router(api)` to the END of server.py
                (after all route definitions).
          Option (b) is the lower-risk one-liner fix.

  - task: "Faza 2.0 WebSocket /ws/rep-locations auth"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          ws://localhost:8001/ws/rep-locations:
          - Connect without sending token within 5s → server closes with
            code 4001 ✅
          - Connect and send {"token":"garbage"} → server replies
            {"type":"auth_error",...} then closes ✅
          - Connect and send valid admin JWT → {"type":"auth_ok"} followed
            by {"type":"snapshot","locations":[...]} with locations array
            (even empty) ✅

  - task: "Faza 2.0 WebSocket /ws/rep-locations broadcast + scope"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Opened 3 WS: admin, manager(of handlowiec), anna(other handlowiec).
          Triggered PUT /api/rep/location as handlowiec:
          - admin WS received {"type":"location_update","rep_id":handlowiec_id,...} ✅
          - manager WS received the same ✅
          - anna (different handlowiec, out of scope) did NOT receive ✅
          Triggered DELETE /api/rep/location as handlowiec:
          - admin WS received {"type":"location_stop","rep_id":handlowiec_id,...} ✅
          - manager WS received the same ✅
          Role scoping in LocationBroadcaster.broadcast() works correctly:
          scope filter excludes handlowieces other than the rep_id in the
          event, while managers only receive events for reps they own.

  - task: "Regression (login/contracts/calendar/finance-v2/idempotency)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          - POST /api/auth/login for admin/manager/handlowiec/anna → 200 ✅
          - GET /api/auth/me (4 roles) → 200 ✅
          - GET /api/contracts (admin) → 200 ✅
          - GET /api/calendar/meetings (admin) → 200 ✅
          - GET /api/dashboard/finance-v2 (admin) → 200 ✅
          - POST /api/contracts with Idempotency-Key replay returns SAME
            contract id (verified on a fresh lead) ✅
          Test cleanup: all created contracts (3) + leads (3) deleted by
          admin.

backend_phase21:
  - task: "Phase 2.1 — Required photo_base64 on POST /leads (handlowiec only)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Verified via /app/backend_test_phase21.py (all assertions PASS).
          - handlowiec POST /api/leads without photo → 400 with Polish message
            containing "Zdjęcie obiektu jest wymagane" ✅
          - photo_base64 = "" → 400 ✅
          - photo_base64 = "x" (len=1 <100) → 400 ✅
          - photo_base64 = "a"*200 → 200 ✅
          - manager POST /leads without photo → 200 (handlowiec-only requirement) ✅
          - admin POST /leads without photo → 200 ✅

  - task: "Phase 2.1 — Anti-collision 50m radius on POST /leads"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Verified via /app/backend_test_phase21.py at a unique coord zone
          (55.126,19.570) to avoid seed interference.
          - Lead A at base → 200 ✅
          - Second lead at ~3m (delta 0.00002 lat/lng) → 409 with Polish
            "Zbyt blisko! Pod tym adresem istnieje już lead w systemie." ✅
          - Lead ~500m away (0.005 lat / 0.010 lng) → 200 ✅
          - Lead ~40m away (0.00035 lat) → 409 ✅
          - Lead ~60m away (0.0006 lat) → 200 (outside radius) ✅
          - PATCH Lead A to status=nie_zainteresowany, then retry at ~3m → 200
            (status=nie_zainteresowany ignored by collision check) ✅

  - task: "Phase 2.1 — meeting_at validation at lead creation"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          POST /api/leads with status=umowione and:
          - meeting_at +1 year → 200 ✅
          - meeting_at +3 years → 400 ("później niż 2 lata w przód") ✅
          - meeting_at = "not a date" → 400 ("Nieprawidłowy format") ✅
          - meeting_at = 5 days ago → 400 ("wcześniejszy niż wczoraj") ✅

  - task: "Phase 2.1 — GET /api/leads/territory-map"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          - No auth → 401 ✅
          - handlowiec / manager / admin → 200 array of
            {id, lat, lng, is_own, status} ✅
          - Own leads returned with is_own=true for handlowiec ✅
          - Same lead returned with is_own=false for manager (not assigned to mgr) ✅
          - Manager + admin see all company leads ✅
          - Leads with status=nie_zainteresowany are NOT included for any role ✅

  - task: "Phase 2.1 — GET /api/rep/work-status"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          - No auth → 401 ✅
          - Handlowiec after DELETE /rep/location → 200 with
            {is_working:false, session_seconds:0, session_distance_m:0.0} ✅
          - After PUT /rep/location → work-status returns is_working:true,
            session_seconds >= 0, session_started_at set ✅
          - After second PUT >10m away → session_distance_m > 0 ✅
          - After DELETE /rep/location → is_working:false ✅
          - Manager work-status for self → 200 ✅

  - task: "Phase 2.1 — Session stats in /api/dashboard/manager reps_live"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          After handlowiec pushes 3 PUT /rep/location points:
          - GET /api/dashboard/manager as manager → 200 ✅
          - reps_live contains handlowiec entry ✅
          - entry has session_seconds (>=0) and session_distance_m (>=0) ✅

  - task: "Phase 2.1 — GET /api/users/{user_id}/profile"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          - No auth → 401 ✅
          - Manager GET own-team handlowiec profile → 200 ✅
          - Admin GET any handlowiec (including anna) → 200 ✅
          - Handlowiec GET self → 200 ✅
          - Handlowiec GET other rep's profile → 403 ✅
          - Invalid user_id → 404 ✅
          Response structure verified:
          - user has {id, email, name, role} ✅
          - kpi has all required: total_leads, signed_count, meeting_count,
            session_seconds, session_distance_m, is_working,
            commission_payable, commission_frozen, contracts_count ✅
          - status_breakdown present (dict) ✅
          - leads is list ✅
          - track is list ✅

  - task: "Phase 2.1 — Regression (calendar/meetings 500 BUG)"
    implemented: true
    working: false
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
      - working: false
        agent: "testing"
        comment: |
          ❌ REGRESSION BUG — GET /api/calendar/meetings returns 500 Internal
          Server Error whenever ANY lead created via POST /api/leads with
          meeting_at coexists with older leads (seeded or PATCHed) whose
          meeting_at is stored as an ISO string.

          Reproduced deterministically:
          1. POST /api/leads as handlowiec with status="umowione" and
             meeting_at=<+1 day ISO> → 200
          2. GET /api/calendar/meetings → 500
             Backend log:
               File "/app/backend/server.py", line 1611, in list_meetings
                 out.sort(key=lambda x: (x["meeting_at"] or ""))
               TypeError: '<' not supported between instances of
               'datetime.datetime' and 'str'

          Root cause:
          In create_lead (server.py line ~431):
              if body.meeting_at:
                  doc["meeting_at"] = _parse_iso_dt(body.meeting_at)
          This stores meeting_at as a Python datetime object in Mongo.
          BUT earlier-seeded leads and leads PATCHed via update_lead store
          meeting_at as an ISO string (update_lead only parses for
          validation but assigns the raw value, or stores a string).
          list_meetings (line 1596-1611) returns l.get("meeting_at")
          verbatim and then sorts. When mixed types are present, Python
          raises TypeError and FastAPI returns 500.

          Impact:
          - /api/calendar/meetings is unusable as soon as a new-style lead
            with meeting_at is created. This is core UX (Kalendarz tab).
          - Fresh DB with only old-format data still works (admin initial
            call returned 200 post-cleanup) — hence my review step 8
            regression for calendar meetings failed.

          Recommended fix (one-liner):
          In create_lead (line 431-432) — serialize back to ISO string before
          insert, matching the existing convention:
              if body.meeting_at:
                  parsed = _parse_iso_dt(body.meeting_at)
                  doc["meeting_at"] = parsed.isoformat() if parsed else body.meeting_at
          OR, more robust, make list_meetings tolerate both:
              def _mkey(v):
                  if isinstance(v, datetime): return v.isoformat()
                  return v or ""
              out.sort(key=lambda x: _mkey(x["meeting_at"]))

          The other Phase 2.1 changes are green; this is the only regression.

agent_communication:
  - agent: "testing"
    message: |
      Phase 2.1 backend testing COMPLETE — /app/backend_test_phase21.py.
      Result: 83 PASS / 3 FAIL (2 of the 3 failures were test-harness issues
      in my initial contract body missing required fields building_type /
      roof_area_m2 / financing_type — re-verified via /tmp/retest.py,
      Idempotency-Key works correctly and returns SAME contract id on replay).

      GREEN (all Phase 2.1 focus tasks):
        ✅ 1) photo_base64 required for handlowiec (400 with "Zdjęcie obiektu
             jest wymagane"); manager/admin exempt; "a"*200 accepted
        ✅ 2) Anti-collision 50m radius: 3m/40m → 409 ("Zbyt blisko!"),
             60m/500m → 200; nie_zainteresowany leads ignored by collision
        ✅ 3) meeting_at validation on POST /leads:
             +1y → 200; +3y → 400; malformed → 400; 5d-ago → 400
             ("wcześniejszy niż wczoraj")
        ✅ 4) GET /api/leads/territory-map: role-scoped, returns
             {id,lat,lng,is_own,status}; nie_zainteresowany excluded;
             handlowiec's own leads have is_own=true
        ✅ 5) GET /api/rep/work-status: 401 unauth; is_working toggles
             correctly on PUT/DELETE /rep/location; session_distance_m grows
             with movement; session_seconds >=0
        ✅ 6) /api/dashboard/manager reps_live now includes session_seconds
             and session_distance_m fields
        ✅ 7) GET /api/users/{user_id}/profile: admin any, manager own team,
             handlowiec self only; 401/403/404 gates correct; response has
             full user/kpi/status_breakdown/leads/track structure with all
             required KPI keys (commission_payable, commission_frozen,
             contracts_count, etc.)
        ✅ 8) Regression GREEN: login (3 roles), /api/contracts,
             /api/dashboard/finance-v2 (cancelled_contracts bucket present),
             PUT /api/rep/location (track_len returned), GET
             /api/tracking/track/{rep_id} (fixed since Phase 2.0 — now
             registered after include_router move), Idempotency-Key on
             POST /api/contracts returns SAME contract id on replay

      ❌ ONE REAL REGRESSION BUG INTRODUCED BY PHASE 2.1:
        GET /api/calendar/meetings → 500 whenever a Phase 2.1-created lead
        with meeting_at coexists with older leads whose meeting_at is a
        string. Backend log:
          File "/app/backend/server.py", line 1611, in list_meetings
            out.sort(key=lambda x: (x["meeting_at"] or ""))
          TypeError: '<' not supported between instances of
          'datetime.datetime' and 'str'
        Root cause: in create_lead (~line 431)
          doc["meeting_at"] = _parse_iso_dt(body.meeting_at)
        stores a datetime, while legacy / PATCHed rows are strings. Sort
        mixes types → 500.
        Suggested fix (one-liner): serialize to ISO string before insert:
          if body.meeting_at:
              parsed = _parse_iso_dt(body.meeting_at)
              doc["meeting_at"] = parsed.isoformat() if parsed else body.meeting_at
        OR make list_meetings sort key coerce datetime→isoformat.

      Cleanup: all 11 test leads and 1 test contract deleted by admin.
      Handlowiec rep_location session stopped. No test residue.


agent_communication:
  - agent: "testing"
    message: |
      Mini-sprint (Y1/C1) + Phase 2.0 backend testing — /app/backend_test_phase20.py.
      Result: 62 PASS / 12 FAIL, where ALL 12 failures trace back to a SINGLE bug
      described below. Every other behaviour is green.

      ✅ Y1: finance-v2 excludes cancelled contracts from totals
        - Created 2 credit contracts today (A gross=100k/margin=20k, B 50k/10k)
        - Baseline admin finance-v2 totals_month captured
        - PATCH A cancelled=true (admin) → status=cancelled
        - After cancel: brutto_sum -100k ✅, margin_sum -20k ✅,
          commission_frozen_sum -10k ✅, signed_count -1 ✅,
          cancelled_count +1 ✅, `cancelled_contracts` array contains A ✅
        - A removed from frozen_contracts / partial_contracts / payable_contracts ✅

      ✅ C1: cancelled_contracts bucket visibility
        - handlowiec (owner) sees A in cancelled_contracts ✅
        - manager (of that rep) sees A in cancelled_contracts ✅
        - admin sees A ✅ (Y1)

      ✅ Phase 2.0: rep_locations track polyline
        - PUT /api/rep/location returns {track_len: N} ✅
        - Near-identical point (<1m) is DEDUPED (track_len unchanged) ✅
        - Point >10m away APPENDED (+1) ✅
        - 500 distinct points → track_len CAPPED at 500 (MAX_TRACK_POINTS) ✅
        - DELETE /api/rep/location → 200; rep_locations.is_active set to false ✅

      ✅ Phase 2.0: WebSocket /ws/rep-locations (ws://localhost:8001/ws/rep-locations)
        AUTH:
          - No token sent within 5s → server closes (code 4001) ✅
          - Invalid token → {"type":"auth_error"} then close ✅
          - Valid admin token → {"type":"auth_ok"} then {"type":"snapshot","locations":[]} ✅
        BROADCAST + SCOPE:
          - 3 listeners (admin / manager / anna-other-handlowiec) open
          - handlowiec PUT /api/rep/location → admin & manager both receive
            {"type":"location_update","rep_id":handlowiec_id,...}; anna does NOT ✅
          - handlowiec DELETE /api/rep/location → admin & manager both receive
            {"type":"location_stop","rep_id":handlowiec_id,...} ✅

      ✅ Regression:
        - POST /api/auth/login (4 users) → 200
        - GET /api/auth/me (4 roles) → 200
        - GET /api/contracts, /api/calendar/meetings, /api/dashboard/finance-v2 → 200
        - Idempotency-Key replay on POST /api/contracts returns SAME id ✅
        - All test contracts & leads cleaned up.

      ❌ ONE CRITICAL BUG — GET /api/tracking/track/{rep_id} returns 404 for ALL callers
        Root cause (confirmed by /openapi.json showing 0 tracking routes):
          In /app/backend/server.py:
            line 1645: `app.include_router(api)`
            line 1801: `@api.get("/tracking/track/{rep_id}")` ← defined AFTER include
          FastAPI snapshots the router's routes when `include_router` is called, so
          the handler is never mounted on the app. curl localhost:8001 and the
          public URL both return 404 "Not Found".
        Impact:
          - All 9 assertions under "GET /api/tracking/track/{rep_id}" section fail
          - 2 additional assertions fail only as a side-effect of this bug (they
            probe is_active via this same endpoint after DELETE /rep/location).
          The DELETE endpoint itself WORKS — this is solely a route-registration bug.
        Recommended fix (one-liner, safe):
          Move `app.include_router(api)` from line ~1645 to the VERY END of
          server.py (after the `@api.get("/tracking/track/{rep_id}")` block).
          Alternatively, move the `@api.get("/tracking/track/{rep_id}")` handler
          (and any other late-defined @api routes) to BEFORE line 1645.

      Nothing else is broken. Phase 2.0 is effectively complete pending the route
      re-registration. WebSocket (which is registered on `app` directly, not via
      `api` router) works perfectly.

  - agent: "testing"
    message: |
      Phase 1.9 (Security & Integrity) backend testing COMPLETE — /app/backend_test_phase19.py.
      Result: 71/71 assertions PASS, 0 failures.

      ✅ K1 signed_at validation:
        - handlowiec: today/yesterday 200; -3d/-15d 400 ("wczorajsza lub dzisiejsza");
          +2d future 400 ("przyszłości")
        - admin: -30d 200; -95d 400 ("90 dni wstecz")
      ✅ W2 commission_percent_override:
        - handlowiec → 403 ("Handlowiec nie może nadpisywać")
        - manager/admin → 200 with commission_percent=99 applied
      ✅ K5 cross-field:
        - margin>gross, down_payment>gross, down_payment<0, roof_area=0,
          installments=0 all → 400 with Polish messages
        - PATCH total_paid>gross*1.05 → 400; within 5% → 200; <0 → 400
      ✅ K6 Idempotency-Key: replay returns same contract id; different key creates 2nd
      ✅ W3 meeting_at: 2099/2020/invalid → 400 with exact Polish messages;
         tomorrow → 200; null → 200 (clearing works — earlier bug resolved)
      ✅ W9 contract_audit_log:
         - After 3 PATCHes → 4 entries returned
         - All required fields (id, contract_id, field, old/new_value, changed_by*,
           changed_at) present; additional_costs entry has reason_note
         - Sorted by changed_at desc; latest entry is cancelled(false→true)
         - Role scope: admin/owner handlowiec/team manager 200;
           unrelated handlowiec 403; nonexistent 404
      ✅ Regression: login/auth/me/settings(GET+PUT admin)/dashboard/finance-v2/
         calendar/meetings/leads CRUD all 200 for respective roles;
         PUT /settings handlowiec 403

      All 10 test contracts and 16 test leads cleaned up via admin DELETE afterwards.
      No blockers. All Phase 1.9 tasks marked working=true.

  - agent: "testing"
    message: |
      Phase 1.8 backend testing COMPLETE — /app/backend_test_phase18.py, 66/66 assertions PASS.

      ✅ GET /api/contracts/{id}:
        - All 20 required fields present (incl. commission_total, commission_total_original,
          effective_margin, additional_costs, additional_costs_note, release_date, etc.)
        - Role scope: admin 200, manager (owning rep) 200, handlowiec (own) 200
        - Cross-team access → 403; nonexistent ID → 404
      ✅ PATCH /api/contracts/{id} admin-only corrections:
        - admin applies additional_costs=2000 + note → effective_margin=gm-2000,
          commission_total = pct/100*effective, commission_total_original unchanged
        - manager → 403, handlowiec → 403 (admin-only on these fields)
        - additional_costs<0 → 400
        - Clearing via additional_costs=0/note="" reverts commission_total
      ✅ PATCH payment (cash contracts):
        - admin 200, manager (own team) 200, handlowiec 403 (endpoint admin+manager only)
      ✅ Dynamic 14-day logic with corrections:
        - signed 20d ago, credit, gm=10000, pct=50 → status=payable, released=5000
        - additional_costs=4000 → commission_total=3000, released=3000, original=5000
        - revert additional_costs=0 → released back to 5000
      ✅ Finance v2 reflects corrections:
        - contracts_all entry shows reduced commission_total (3750) and additional_costs=2500
      ✅ Regression: auth/login (3 roles), /auth/me (3 roles), /settings (3 roles) all 200
      ✅ Test artifacts cleaned up (contracts/leads/temp user deleted).

      No blockers, no new bugs. Both focus tasks marked working=true.

  - agent: "main"
    message: |
      Implemented Phase 1.5: Commission Calculator widget (Admin/Manager/Rep dashboards),
      Admin Settings fields (commission_percent + margin_per_m2) and fixed PDF guarantee text
      removing all PV mentions. Please backend-test /api/settings GET + PUT including:
      (1) seeded defaults (commission_percent=50, margin_per_m2=50) are returned on GET;
      (2) admin can PUT both fields and values persist;
      (3) manager/handlowiec receive 403 on PUT but can GET (needed by widget);
      (4) no regressions on /api/auth/login, /api/auth/me, /api/leads CRUD,
          /api/dashboard/manager, /api/dashboard/rep, /api/rep/location.
      Credentials in /app/memory/test_credentials.md (password: test1234).

  - agent: "testing"
    message: |
      Backend testing complete — 26/26 assertions now pass (see /app/backend_test.py).
      All endpoints behave as expected: auth, leads CRUD with proper RBAC
      (handlowiec DELETE=403, admin DELETE=200), manager dashboard, rep dashboard,
      rep live location, and /api/settings PUT/GET with admin-only 403 gating.

      ⚠ Migration caveat (not a blocker — please fix before prod):
      The `settings/global` document in MongoDB was created by an earlier seed run that
      pre-dated the `commission_percent` / `margin_per_m2` fields. seed_data() only
      `insert_one`s when the doc is missing, so on any existing deployment the two new
      fields are NOT present in the stored doc and GET /api/settings returns them missing.
      After my test suite ran the admin PUT, the fields were written and all subsequent
      GETs return them correctly — so the DB is now healthy in this environment.
      However production upgrades will have the same silent hole, breaking the

  - agent: "testing"
    message: |
      Phase 1.7 (Contracts + Calendar + Finance v2) testing COMPLETE.
      Test file: /app/backend_test_phase17.py. Result: 106 PASS / 1 FAIL out of 107 assertions.

      ✅ GREEN:
        - All /api/contracts CRUD + auth gating (401/403) + role scoping ✅
        - Dynamic 14-day commission logic (frozen / partial / payable / cancelled)
          across credit & cash, within and after withdrawal window ✅
        - commission_amount = commission_percent/100 * global_margin — verified ✅
        - Linked lead auto-flipped to status="podpisana" on contract creation ✅
        - /api/calendar/meetings: auth, role scoping (rep ⊂ manager ⊂ admin),
          sorting by meeting_at ✅
        - /api/dashboard/finance-v2: auth, buckets (payable/frozen/partial),
          totals_month, contracts_month, by_rep, role scoping ✅
        - Regression: /api/auth/login (3 roles), /api/settings, /api/dashboard/manager,
          /api/dashboard/rep, /api/dashboard/finance (legacy), /api/leads CRUD — all 200 ✅

      ❌ ONE BUG FOUND (PATCH /api/leads, not a new endpoint):
        PATCH /api/leads/{id} with body {"meeting_at": null} returns 200 but does NOT
        clear the field. Root cause in server.py update_lead() line ~372:
            updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
        The `is not None` filter silently drops all null values, so NO nullable field
        on a lead can ever be un-set via PATCH (meeting_at, phone, address,
        latitude, longitude, building_area, assigned_to, etc.).
        Recommended fix:
            updates = body.dict(exclude_unset=True)
        (exclude_unset already removes fields the client didn't send; null values
        the client DID send should reach the DB as $set: null.)
        This is the only gap vs the review spec. The Calendar endpoint itself is
        correct; it just has no way to un-schedule a meeting today.

      No action needed on /api/contracts, /api/calendar/meetings, /api/dashboard/finance-v2
      — those are production-ready.
      CommissionCalculator widget for non-admins until someone manually saves settings.

      Recommendation for MAIN AGENT: extend seed_data() to always `$set` missing
      default fields on the existing settings doc, e.g.
          defaults = SettingsIn().dict()
          existing = await db.settings.find_one({"id": "global"}) or {}
          missing = {k: v for k, v in defaults.items() if k not in existing}
          if missing:
              await db.settings.update_one({"id": "global"}, {"$set": missing}, upsert=True)
      No other fixes needed.

  - agent: "testing"
    message: |
      Phase 1.6 Finance dashboard testing complete — 29/29 assertions PASS
      (see /app/backend_test_finance.py).
      - Auth: 401 unauth, 200 for admin/manager/handlowiec.
      - Response shape: all required top-level keys, period ISO bounds,
        settings_snapshot, totals_month (all numeric), by_rep item keys,
        and each contract entry with id/client_name/area/building_type/
        base_netto/margin_netto/total_netto/vat/vat_label/total_brutto/commission.
      - Role scoping: handlowiec sees only own leads; manager ⊇ handlowiec;
        admin ⊇ manager for both contracts_month and contracts_all.
      - Math: created 4 signed test leads as handlowiec and validated all fields
        against live settings values (tolerance ±0.01 PLN):
          A) mieszkalny 150m² → VAT 8%, expected values match ✅
          B) gospodarczy 180m² → VAT 23% ✅
          C) mieszkalny 250m² → base_high=200, VAT 8% ✅
          D) mieszkalny 400m² → Mixed VAT (300/400*8% + 100/400*23% = 11.75%) ✅
        All 4 test leads cleaned up via admin DELETE.
      - Regression: GET /api/settings, /api/dashboard/manager, /api/dashboard/rep
        all 200; commission_percent/margin_per_m2/base_price_low/base_price_high
        still returned.
      Minor observation: live DB has margin_per_m2=100.0 (not the default 50.0)
      from a prior admin PUT. Math assertions used live settings so this is not
      a failure — just a heads-up in case the review expected defaults.


# ──────────────────────────────────────────────────────────────────────────────
# BATCH A — BACKEND SECURITY HARDENING (2026-04-23)
# ──────────────────────────────────────────────────────────────────────────────
backend:
  - task: "Batch A #3 — CORS whitelist via CSV env var"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Replaced allow_origins=["*"] with CSV parse of CORS_ALLOWED_ORIGINS env var.
          Empty var → wildcard fallback + WARNING log (dev only).
          Non-empty var → strict whitelist + allow_credentials=True.

  - task: "Batch A #4 — JWT_SECRET strength validation + APP_ENV gating"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added APP_ENV env var (default "development"). _validate_jwt_secret()
          checks length >= 32 and blocks well-known weak values
          (change-me/secret/dev/test/default). When APP_ENV=production and
          JWT_SECRET is weak → raise SystemExit(1) refusing to boot. In dev
          a WARNING is logged instead. Verified via subprocess test.

  - task: "Batch A #5 — SEED_DEMO gating on startup"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Extracted ensure_indexes_and_migrations() (always runs).
          seed_data() (6 demo users + 10 leads) now gated by SEED_DEMO=="1".
          Dev .env has SEED_DEMO=1 → demo users intact. Prod will omit it,
          skipping demo seed entirely.

  - task: "Batch A #6 — Bootstrap admin + must_change_password flow"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          seed_prod_admin_if_empty() runs always but only acts when users
          collection is empty. Creates a single admin with random 20+ char
          password (secrets.token_urlsafe(16)), must_change_password=True.
          Password is printed ONCE to stdout (not persisted anywhere).

          New field must_change_password on user docs (migration backfills
          existing users with False). serialize_user exposes it in /auth/me
          and /auth/login responses.

          POST /api/auth/change-password endpoint: validates new_password
          length>=12 + has letter + has digit, verifies current_password,
          updates hash AND clears flag.

          require_password_changed dependency blocks write endpoints when
          flag is True: applied implicitly via require_roles() AND explicitly
          on POST /contracts (which uses plain get_current_user). Integration
          test confirms 403 "Password change required" while GET endpoints
          and /auth/change-password remain accessible.

  - task: "Batch A — test coverage"
    implemented: true
    working: true
    file: "/app/backend/tests/test_oze_crm_api.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added TestBatchASecurity class with 7 tests:
            - test_cors_whitelist_blocks_unknown_origin (skipped in dev wildcard mode)
            - test_weak_jwt_secret_fails_in_prod (subprocess import of server.py)
            - test_seed_demo_enabled_test_users_present
            - test_change_password_success (full flow w/ throwaway user)
            - test_change_password_rejects_weak (too short, no digit, wrong current pw)
            - test_must_change_password_flag_in_me
            - test_must_change_password_blocks_sensitive_endpoints

          Suite result: 40 passed, 1 skipped (CORS by design in dev), 1 pre-existing
          failure (TestLeads::test_create_lead_as_handlowiec — needs photo_base64,
          unrelated to Batch A). No regressions introduced.

metadata:
  batch_a_complete: true
  batch_a_date: "2026-04-23"
  dev_compatibility: "admin@test.com / test1234 login still works — verified"

      No blockers. Endpoint is production-ready.


# ──────────────────────────────────────────────────────────────────────────────
# SPRINT 5-PRE — Pre-APK MVP critical fixes (2026-04-25)
# ──────────────────────────────────────────────────────────────────────────────
sprint_5_pre_summary:
  date: "2026-04-25"
  scope: "ISSUE-014 (offline queue stuck syncing) + ISSUE-017 (GPS batch) + 8 date-flake test fixes"
  baseline_before: "79 passed / 8 failed / 2 skipped"
  baseline_after: "94 passed / 0 failed / 2 skipped"
  files_touched:
    - "/app/frontend/src/lib/offlineQueue.ts (+resetStaleSyncing, wired into startAutoSync)"
    - "/app/backend/server.py (+RepLocationBatchPoint/RepLocationBatchIn models, +PUT /api/rep/location/batch endpoint)"
    - "/app/frontend/src/lib/backgroundTracking.ts (TaskManager now PUTs full batch instead of last point)"
    - "/app/backend/tests/test_oze_crm_api.py (+yesterday_iso/today_iso helpers, +TestRepLocationBatch class with 7 tests, fixed PII broadcast assertions in 2 tests, replaced 10× hardcoded 2026-04-23 dates with helper)"
  backward_compat_verified: |
    Old PUT /api/rep/location remains untouched. test_single_point_endpoint_still_works
    confirms 200 OK + track_len contract intact. Both endpoints write to the same
    rep_locations doc.
  agent_handoff_for_next:
    -agent: "main"
    -message: |
      Sprint 5-pre Tasks 2 + 3 complete + 8 date-flake tests fixed.
      
      Task 2 (ISSUE-014, frontend only):
        offlineQueue.ts now has resetStaleSyncing(maxAgeMs=5*60_000). Hooked
        into startAutoSync() — runs once at boot AND on every 15s tick.
        Re-queues stuck "syncing" ops back to "pending" so the queue can
        resume after a force-quit/crash mid-flight.
      
      Task 3 (ISSUE-017, full stack + tests):
        Backend: PUT /api/rep/location/batch + RepLocationBatchIn model.
        Old PUT /api/rep/location preserved 100% intact for backward compat.
        Same haversine 10m dedup, MAX_TRACK_POINTS=500 cap, midnight session
        rollover, single Mongo write, single WS broadcast at end.
        Hard cap 100 points/batch (400 if exceeded), empty list (400).
        Frontend: backgroundTracking.ts now sends the FULL batch from
        TaskManager (was: only locations[locations.length-1]).
        Tests: +7 new in TestRepLocationBatch (auth gate, empty,
        distinct-points, dedup, cap, single-point backward compat,
        manager dashboard reflects batch tail).
      
      Plus: yesterday_iso() helper at top of test file. Replaced all 10
      "2026-04-23" hardcodes with helper calls. Updated 2 stale broadcast
      tests that were checking PII fields removed by Batch 2 audit
      (now assert thin payload only).
      
      Result: 79 passed / 8 failed / 2 skipped → 94 passed / 0 failed / 2 skipped.
      yarn tsc --noEmit: 0 errors. Backend reloads clean.
      
      No frontend automatic testing requested by user. Awaiting user manual
      verification in preview / on real device with APK.

  - agent: "testing"
    message: |
      Sprint 5-pre — Backend testing of NEW PUT /api/rep/location/batch endpoint
      and backward-compat with PUT /api/rep/location.
      Test scripts: pytest /app/backend/tests/test_oze_crm_api.py + manual
      smoke tests in /app/backend_test_sprint5pre.py (against the public
      EXPO_PUBLIC_BACKEND_URL).

      ✅ PYTEST FULL SUITE
        Result: 94 passed, 2 skipped, 0 failed (in 56.48s) — exactly as
        expected. All 7 tests in the new TestRepLocationBatch class pass:
          - test_batch_requires_auth ✅
          - test_batch_empty_400 ✅
          - test_batch_appends_all_distinct_points ✅
          - test_batch_dedupes_near_identical ✅
          - test_batch_over_cap_400 ✅
          - test_single_point_endpoint_still_works ✅
          - test_dashboard_manager_picks_up_batch_position ✅

      ✅ MANUAL CURL SMOKE TESTS (against public BASE_URL)
        (a) PUT /api/rep/location/batch unauthenticated → 401 ✅
        (b) Empty {points: []} as handlowiec →
            400 {"detail":"Batch musi zawierać co najmniej 1 punkt."} ✅
            (matches required Polish message "co najmniej 1" / "1 punkt")
        (c) 5 distinct points (52.10..52.104, lon 21.00) as handlowiec →
            200 {ok:true, received:5, appended:5, track_len:5} ✅
        (d) 4 near-identical points (~0.5m apart) →
            200 {ok:true, received:4, appended:1, track_len:1} →
            3 deduped by haversine (appended <= 1 ✅)
        (e) 101 points →
            400 {"detail":"Batch może zawierać maksymalnie 100 punktów."} ✅
            (contains "100" as required)
        (f) BACKWARD COMPAT: single-point PUT /api/rep/location as
            handlowiec with {lat:52.20, lng:21.05, accuracy:5} →
            200 {ok:true, track_len:1} ✅ (track_len present)

      ✅ SCENARIO 3: Manager dashboard picks up LAST batch point
        After re-uploading the 5-point batch, GET /api/dashboard/manager
        as manager → reps_live[handlowiec].lat == 52.104 (the LAST point
        in the batch) ✅. Verified entry:
          {user_id, name:"Jan Handlowiec", lat:52.104, lng:21.0,
           accuracy:5, active:true, session_distance_m:444.8,
           activity_status:"active"}.
        This proves a single batch upload propagates to the manager
        dashboard with the last position visible (no reliance on the
        single-point endpoint).

      ✅ CONFIRMATION: Both endpoints work in PARALLEL
        Pytest test_single_point_endpoint_still_works PASSES (tests both
        endpoints in same flow). Manual scenario (f) confirms the OLD
        single-point endpoint returns 200 with track_len. New batch
        endpoint runs alongside it without interference. Dedup, MAX 500
        cap and midnight session reset are shared between them.

      All 19 manual assertions PASS / 0 FAIL.
      Cleanup: DELETE /api/rep/location was issued before each scenario
      and at the end. No test residue.

      No unexpected behaviour observed. Sprint 5-pre Task 3 is fully
      green from the backend side. (Task 2 — offline queue
      resetStaleSyncing — is frontend-only and was explicitly excluded
      from this run per spec.)


    -agent: "testing"
    -message: |
      Sprint 5-pre-bis ISSUE-UX-001 — backend verification COMPLETE.

      pytest tests/test_oze_crm_api.py:
        passed: 97
        failed: 0
        skipped: 2
        TestAutoStatusOnContract: 3/3 PASS
          - test_lead_status_changes_to_podpisana_on_contract_create ✅
          - test_lead_already_podpisana_no_extra_audit_entry ✅
          - test_idempotent_replay_does_not_double_audit ✅

      Manual smoke (script /app/backend_test_sprint5_pre_bis.py, all 12/12 PASS):
        a) login handlowiec@test.com → 200 ✅
        b) POST /api/leads with status=umowione + photo_base64 + GPS near
           53.5/18.0 (client_name=AUTO_TEST_<ts>) → 200 ✅
        c) POST /api/contracts as handlowiec (cash, signed_at=yesterday,
           gross 45000, panele 25000+5kW, magazyn 15000+5kWh,
           building_type=mieszkalny, roof_area_m2=100, pesel_last4=1234,
           short client_signature_b64) → 200 ✅
        d) GET /api/leads as manager — lead has:
              status="podpisana" ✅
              status_auto_changed_reason="contract_created" ✅
              status_auto_changed_at="2026-04-25T11:05:11.905000" (non-null) ✅
        e) Second POST /api/contracts on same lead with NEW Idempotency-Key
              → 200 with NEW contract_id ≠ first ✅
              lead.status STILL "podpisana" ✅
              status_auto_changed_at unchanged (no second audit) ✅
        f) Idempotency replay: 2 POSTs with SAME Idempotency-Key → both 200
              and SAME contract_id (e0a7b170-…); no duplicate created ✅

      Regression sanity (Sprint 5-pre Task 3):
        PUT /api/rep/location/batch with 3 distinct pts as handlowiec →
          200 {"ok":true,"track_len":4,"appended":3,"received":3} ✅
        DELETE /api/rep/location → 200 ✅
        No regression observed.

      Backend logs confirm correct behaviour:
        "Lead 672c79bd-1e7e-4796-aa66-d89c36cac94e status auto-changed:
         umowione → podpisana (contract 3bf4103e-…)"
        Replay POST returned same id without firing a second status flip.

      No unexpected behaviour. ISSUE-UX-001 is verified and stable.
      Polski: Funkcja auto-zmiany statusu leada na "podpisana" po utworzeniu
      kontraktu działa poprawnie — bez podwójnych wpisów w audycie i z
      poprawnymi metadanymi (status_auto_changed_reason, status_auto_changed_at).


# --- Sprint 5-pre-quad backend retest (appended 2026-04-25 13:10 by testing agent) ---
agent_communication:
  - agent: "testing"
    message: |
      Sprint 5-pre-quad — Backend testing of phone+email field on
      /dashboard/manager reps_live[]: ALL CHECKS PASS.

      1) FULL pytest suite (cd /app/backend && pytest tests/test_oze_crm_api.py -v):
         **98 passed, 2 skipped, 0 failed** ✅ — matches expected baseline.
         New test TestRepsLiveContact::test_reps_live_includes_phone_and_email_fields
         passes. The 2 skips are the two pre-existing intentional skips
         (TestBatchASecurity::test_cors_whitelist_blocks_unknown_origin and
         TestRateLimiting::test_login_throttled_after_5_attempts_when_enabled —
         both env-gated).

      2) Manual smoke against public BASE_URL
         (https://renewable-sales-hub.preview.emergentagent.com/api),
         script /app/backend_test_sprint5_pre_quad.py — 23/23 PASS:
         a1) login handlowiec@test.com / test1234 → 200 ✅
         a2) PUT /api/rep/location {latitude:52.0, longitude:19.0,
             accuracy:5.0} → 200 {"ok":true, "track_len":N} ✅
             (Note: backend Pydantic model uses field names `latitude`/
             `longitude` — the review spec wording "lat=52.0, lng=19.0"
             was just shorthand, not a literal field name.)
         b1) login manager@test.com → 200 ✅
         b2) GET /api/dashboard/manager → 200 ✅
         b3) reps_live[] non-empty (5 reps after seeding all 4 demo
             handlowcy + manager test rep) ✅
         c1) reps_live[0] has key "phone" ✅
         c2) reps_live[0] has key "email" ✅
         c3) Existing fields user_id / name / lat / lng all still present —
             no regression on the previously-tested shape ✅
         c4) reps_live[0].email parses as a valid address (handlowiec@test.com,
             ewa@test.com, etc.) ✅

         d) PHONE NON-NULL FOR ALL SEEDED USERS (manager + 4 handlowcy):
            handlowiec@test.com → "+48 500 100 200" ✅
            anna@test.com       → "+48 500 100 201" ✅
            piotr@test.com      → "+48 500 100 202" ✅
            ewa@test.com        → "+48 500 100 203" ✅
            All four start with "+48" prefix as documented in upsert_user
            seed code. Manager themselves (manager@test.com) does not
            appear in their own /dashboard/manager.reps_live (expected —
            reps_live filters to role=handlowiec only).

      3) BACKWARD COMPAT (Sprint 5-pre + Sprint 5-pre-bis still green):
         bc1) PUT /api/rep/location/batch with 3 distinct points as
              handlowiec → 200
              {"ok":true,"track_len":N,"appended":3,"received":3} ✅
         bc2a) POST /api/leads (umowione, photo_base64, GPS, meeting_at
              tomorrow) → 200, lead created with id ✅
         bc2b) POST /api/contracts (cash, signed_at=yesterday,
              financing_type=cash, gross_amount=50000, down_payment=5000,
              installments=12, building_type=mieszkalny, roof_area_m2=100)
              → 200 contract created ✅
         bc2c) Lead.status auto-flipped to "podpisana"
              (Sprint 5-pre-bis ISSUE-UX-001) ✅
         bc2d) Lead.status_auto_changed_reason == "contract_created" ✅
         Backend log line confirmed in /var/log/supervisor/backend.err.log:
              "Lead 7df1719b-8e8d-4a1c-b4a2-03310496f432 status auto-changed:
               umowione → podpisana (contract cf0909e9-…)"
         (111 such lines total across the test session — auto-status fires
         on every contract create as expected.)

      Sprint 5-pre-quad backend implementation is **production-ready**. The
      two new keys `phone` + `email` on reps_live[] are present for ALL
      seeded users, populated with the new +48 500 100 20X seed values,
      no regression on user_id/name/lat/lng/active/battery/last_seen_seconds/
      activity_status etc.

      Polski:
      Test backend Sprint 5-pre-quad zakończony sukcesem. Wszystkie 98
      testów pytest zielone (2 pominięte = preexisting środowiskowe).
      Manualne testy przeciwko publicznemu URL — 23/23 PASS. Pola phone
      i email są obecne w reps_live[] dla wszystkich 4 zalogowanych
      handlowców (jan, anna, piotr, ewa) z polskimi numerami +48 500 100 20X.
      Funkcje wsteczne (Sprint 5-pre /location/batch i Sprint 5-pre-bis
      auto-zmiana statusu leada) działają bez regresji.
