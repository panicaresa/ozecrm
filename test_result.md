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
  version: "1.9"
  test_sequence: 8
  run_ui: false

test_plan:
  current_focus:
    - "K1: signed_at validation (handlowiec 2d max back, admin 90d max, no future >1d)"
    - "K5: gross/margin/down_payment cross-validation"
    - "K6: Idempotency-Key deduplication on POST /contracts"
    - "W2: commission_percent_override forbidden for handlowiec"
    - "W3: meeting_at range validation"
    - "W9: contract_audit_log on PATCH + new endpoint /contracts/{id}/audit-log"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
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
      No blockers. Endpoint is production-ready.