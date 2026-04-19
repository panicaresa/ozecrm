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

metadata:
  created_by: "main_agent"
  version: "1.6"
  test_sequence: 4
  run_ui: false

test_plan:
  current_focus:
    - "Finance dashboard endpoint /api/dashboard/finance"
    - "Settings endpoint supports commission_percent + margin_per_m2"
    - "All existing auth + leads + dashboards endpoints remain green"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
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