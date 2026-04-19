# PRD — Grupa OZE CRM (Mobile, Expo + FastAPI + MongoDB)

## Vision
Internal B2B CRM for a Polish renewable-energy (OZE) company combining a
door-to-door sales force management tool with a powerful OZE offer generator.

## Roles (RBAC)
- **Admin** — manage users, global tariff config (base prices per m², RRSO list,
  excluded postal codes, company data), full visibility.
- **Manager (Team Leader)** — Centrum Dowodzenia dashboard (KPI, progress bars,
  lead status donut, Top-3 ranking, Lead Map), manage team leads.
- **Handlowiec (Field Rep)** — Start/Stop work mode, add leads with geotag +
  photo, Offer Generator with PDF export, personal results.

## MVP Features (shipped)
- JWT auth (Bearer) with seeded users for the 3 roles.
- Manager dashboard: KPI (Spotkania / Nowe leady / Wyceny / Aktywni),
  Cele i postęp, Statusy leadów (donut via react-native-svg), Top-3 ranking,
  Lead Map (native: react-native-maps; web: styled list fallback).
- Lead CRUD with role-based visibility. Leads carry GPS, photo (base64),
  postal code, area, building type (mieszkalny/gospodarczy), status.
- OZE Offer Generator (multi-step wizard) with full HTML logic port:
  - VAT: 8% residential ≤300 m², 23% for gospodarczy, proportional mixed
    rate for residential >300 m².
  - Base price tiers: ≤200 m² → base_price_low, >200 m² → base_price_high.
  - Margin distributed over total m². Optional discount + subsidy applied to
    gross. Santander 10.75% RRSO default installment formula.
  - Postal-code subsidy exclusion check.
  - PDF generation via expo-print (native) / new-window HTML (web).
- Admin settings panel (tariffs, RRSO list, excluded ZIP, company data) +
  user management with role assignment.

## Stack
- **Backend:** FastAPI + Motor/MongoDB, bcrypt, PyJWT. Single `server.py`
  under `/api` prefix. Seed script creates users, goals, demo leads.
- **Frontend:** Expo SDK 54, expo-router file-based routing, react-native
  components only, StyleSheet, @expo/vector-icons (Feather), react-native-svg,
  expo-print, expo-location, expo-image-picker, expo-secure-store
  (localStorage fallback on web).
- **Auth:** JWT Bearer stored in SecureStore on native / localStorage on web.

## Test Credentials
| Role | Email | Password |
|------|-------|----------|
| admin | admin@test.com | test1234 |
| manager | manager@test.com | test1234 |
| handlowiec | handlowiec@test.com | test1234 |
Plus 3 extra handlowcy seeded under manager@test.com: anna@/piotr@/ewa@test.com.

## Key APIs
- POST `/api/auth/login`, GET `/api/auth/me`, POST `/api/auth/register` (admin)
- GET/PATCH/POST/DELETE `/api/leads`, GET `/api/users`
- GET `/api/settings` (any), PUT `/api/settings` (admin)
- GET `/api/dashboard/manager`, GET `/api/dashboard/rep`
- PUT `/api/goals` (admin/manager)

## Not in MVP (v2.0 backlog)
- Background GPS tracking for active reps (expo-task-manager + expo-location
  backgroundUpdates).
- Real-time live tracking with WebSockets (architecture ready: manager
  dashboard already polls aggregated data via HTTP — swap to WS later).
- Map clustering on native (current: simple markers).
- Offer draft save/load, photo attachments in offer, e-signature.
- Push notifications for lead assignments.

## Business Enhancement (smart upsell)
The offer generator is the conversion engine. Next iterations should:
1. **A/B-test RRSO framing** (monthly rate vs total cost) — track which closes
   faster. Logged offer outcomes correlated to lead.status=podpisana will
   reveal the winning script.
2. **Self-service "zapisz ofertę" share link** that opens in the client's
   browser with installment calculator → turn every lead into a micro-landing
   page the client can forward to the spouse / decision-maker.
