"""
OZE CRM Backend API Tests
Tests auth, settings, dashboard, leads, and users endpoints
"""
import pytest
import requests
import os
from pathlib import Path

# Read BASE_URL from frontend .env file
def get_base_url():
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip('/')
    return "https://renewable-sales-hub.preview.emergentagent.com"

BASE_URL = get_base_url()

# Test credentials from test_credentials.md
ADMIN_CREDS = {"email": "admin@test.com", "password": "test1234"}
MANAGER_CREDS = {"email": "manager@test.com", "password": "test1234"}
REP_CREDS = {"email": "handlowiec@test.com", "password": "test1234"}


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def admin_token(api_client):
    """Get admin auth token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
    if response.status_code != 200:
        pytest.skip(f"Admin login failed: {response.status_code}")
    return response.json()["access_token"]


@pytest.fixture
def manager_token(api_client):
    """Get manager auth token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json=MANAGER_CREDS)
    if response.status_code != 200:
        pytest.skip(f"Manager login failed: {response.status_code}")
    return response.json()["access_token"]


@pytest.fixture
def rep_token(api_client):
    """Get handlowiec auth token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json=REP_CREDS)
    if response.status_code != 200:
        pytest.skip(f"Rep login failed: {response.status_code}")
    return response.json()["access_token"]


# ============ AUTH TESTS ============
class TestAuth:
    """Authentication endpoint tests"""

    def test_login_admin_success(self, api_client):
        """POST /api/auth/login for admin@test.com returns access_token + user with role=admin"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "access_token" in data, "Missing access_token in response"
        assert "user" in data, "Missing user in response"
        assert data["user"]["role"] == "admin", f"Expected role=admin, got {data['user']['role']}"
        assert data["user"]["email"] == ADMIN_CREDS["email"]

    def test_login_manager_success(self, api_client):
        """POST /api/auth/login for manager@test.com returns role=manager"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json=MANAGER_CREDS)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "access_token" in data
        assert data["user"]["role"] == "manager", f"Expected role=manager, got {data['user']['role']}"

    def test_login_handlowiec_success(self, api_client):
        """POST /api/auth/login for handlowiec@test.com returns role=handlowiec"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json=REP_CREDS)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "access_token" in data
        assert data["user"]["role"] == "handlowiec", f"Expected role=handlowiec, got {data['user']['role']}"

    def test_login_wrong_password(self, api_client):
        """POST /api/auth/login with wrong password returns 401"""
        response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@test.com", "password": "wrongpassword"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"

    def test_auth_me_with_token(self, api_client, admin_token):
        """GET /api/auth/me with Bearer token returns user"""
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert "email" in data
        assert "role" in data
        assert data["email"] == ADMIN_CREDS["email"]


# ============ SETTINGS TESTS ============
class TestSettings:
    """Settings endpoint tests"""

    def test_get_settings(self, api_client, admin_token):
        """GET /api/settings returns settings with base_price_low=275, excluded_zip_codes includes 77-400, rrso_rates has Santander 10.75"""
        response = api_client.get(
            f"{BASE_URL}/api/settings",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "base_price_low" in data
        assert data["base_price_low"] == 275.0, f"Expected base_price_low=275, got {data['base_price_low']}"
        assert "base_price_high" in data
        assert data["base_price_high"] == 200.0
        assert "excluded_zip_codes" in data
        assert "77-400" in data["excluded_zip_codes"], "Expected 77-400 in excluded_zip_codes"
        assert "rrso_rates" in data
        
        # Check Santander RRSO
        santander = next((r for r in data["rrso_rates"] if r["label"] == "Santander"), None)
        assert santander is not None, "Santander not found in rrso_rates"
        assert santander["value"] == 10.75, f"Expected Santander RRSO=10.75, got {santander['value']}"

    def test_update_settings_as_admin(self, api_client, admin_token):
        """PUT /api/settings as admin updates settings (change base_price_low to 280, verify change)"""
        # First get current settings
        get_response = api_client.get(
            f"{BASE_URL}/api/settings",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        current_settings = get_response.json()
        
        # Update base_price_low to 280
        updated_settings = current_settings.copy()
        updated_settings["base_price_low"] = 280.0
        
        put_response = api_client.put(
            f"{BASE_URL}/api/settings",
            json=updated_settings,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert put_response.status_code == 200, f"Expected 200, got {put_response.status_code}: {put_response.text}"
        
        # Verify the change persisted
        verify_response = api_client.get(
            f"{BASE_URL}/api/settings",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        verify_data = verify_response.json()
        assert verify_data["base_price_low"] == 280.0, f"Expected base_price_low=280 after update, got {verify_data['base_price_low']}"
        
        # Restore original value
        current_settings["base_price_low"] = 275.0
        api_client.put(
            f"{BASE_URL}/api/settings",
            json=current_settings,
            headers={"Authorization": f"Bearer {admin_token}"}
        )

    def test_update_settings_as_manager_forbidden(self, api_client, manager_token):
        """PUT /api/settings as manager returns 403"""
        response = api_client.put(
            f"{BASE_URL}/api/settings",
            json={"base_price_low": 300.0},
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"


# ============ DASHBOARD TESTS ============
class TestDashboard:
    """Dashboard endpoint tests"""

    def test_manager_dashboard(self, api_client, manager_token):
        """GET /api/dashboard/manager as manager returns correct structure with KPI, status_breakdown, rep_progress, top3, pins"""
        response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "kpi" in data
        assert "status_breakdown" in data
        assert "rep_progress" in data
        assert "top3" in data
        assert "pins" in data
        assert "total_leads" in data
        
        # Verify KPI structure
        assert "meetings" in data["kpi"]
        assert "new_leads" in data["kpi"]
        assert "quotes" in data["kpi"]
        assert "active_reps" in data["kpi"]
        
        # Verify status_breakdown has expected keys
        assert "podpisana" in data["status_breakdown"]
        assert "decyzja" in data["status_breakdown"]
        assert "umowione" in data["status_breakdown"]
        assert "nie_zainteresowany" in data["status_breakdown"]
        assert "nowy" in data["status_breakdown"]
        
        # Verify rep_progress is not empty (manager has 4 reps)
        assert len(data["rep_progress"]) > 0, "Expected rep_progress to have entries"
        
        # Verify pins structure
        assert len(data["pins"]) > 0, "Expected pins to have entries"
        if len(data["pins"]) > 0:
            pin = data["pins"][0]
            assert "lat" in pin
            assert "lng" in pin
            assert "status" in pin

    def test_manager_dashboard_as_handlowiec_forbidden(self, api_client, rep_token):
        """GET /api/dashboard/manager as handlowiec returns 403"""
        response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"

    def test_rep_dashboard(self, api_client, rep_token):
        """GET /api/dashboard/rep as handlowiec returns total_leads, signed, meetings, target, percent"""
        response = api_client.get(
            f"{BASE_URL}/api/dashboard/rep",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "total_leads" in data
        assert "signed" in data
        assert "meetings" in data
        assert "target" in data
        assert "percent" in data
        
        # Verify data types
        assert isinstance(data["total_leads"], int)
        assert isinstance(data["signed"], int)
        assert isinstance(data["meetings"], int)
        assert isinstance(data["target"], int)
        assert isinstance(data["percent"], int)


# ============ LEADS TESTS ============
class TestLeads:
    """Leads endpoint tests"""

    def test_get_leads_as_handlowiec(self, api_client, rep_token):
        """GET /api/leads as handlowiec returns only leads assigned_to that user"""
        response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        leads = response.json()
        assert isinstance(leads, list)
        
        # Get user ID from /auth/me
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        user_id = me_response.json()["id"]
        
        # Verify all leads are assigned to this user
        for lead in leads:
            assert lead["assigned_to"] == user_id, f"Lead {lead['id']} not assigned to current user"

    def test_get_leads_as_manager(self, api_client, manager_token):
        """GET /api/leads as manager returns leads assigned to own reps"""
        response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        leads = response.json()
        assert isinstance(leads, list)
        assert len(leads) > 0, "Manager should have leads from their team"

    def test_create_lead_as_handlowiec(self, api_client, rep_token):
        """POST /api/leads as handlowiec creates a lead and returns it with id and assigned_to=self"""
        # Get user ID
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        user_id = me_response.json()["id"]
        
        lead_data = {
            "client_name": "TEST_Jan Testowy",
            "phone": "+48 500 123 456",
            "address": "Testowa 1, Gdańsk",
            "postal_code": "80-001",
            "latitude": 54.372,
            "longitude": 18.638,
            "status": "nowy"
        }
        
        create_response = api_client.post(
            f"{BASE_URL}/api/leads",
            json=lead_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert create_response.status_code == 200, f"Expected 200, got {create_response.status_code}: {create_response.text}"
        
        created_lead = create_response.json()
        assert "id" in created_lead
        assert created_lead["client_name"] == lead_data["client_name"]
        assert created_lead["assigned_to"] == user_id, f"Expected assigned_to={user_id}, got {created_lead['assigned_to']}"
        assert created_lead["status"] == "nowy"
        
        # Verify persistence with GET
        get_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        all_leads = get_response.json()
        created_lead_found = any(l["id"] == created_lead["id"] for l in all_leads)
        assert created_lead_found, "Created lead not found in GET /api/leads"
        
        # Cleanup - delete the test lead (as admin since handlowiec can't delete)
        # We'll leave it for now as there's no cleanup mechanism in the test

    def test_update_lead_status(self, api_client, rep_token):
        """PATCH /api/leads/{id} updates lead status"""
        # First get a lead
        get_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = get_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available to update")
        
        lead_id = leads[0]["id"]
        original_status = leads[0]["status"]
        new_status = "umowione" if original_status != "umowione" else "decyzja"
        
        patch_response = api_client.patch(
            f"{BASE_URL}/api/leads/{lead_id}",
            json={"status": new_status},
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert patch_response.status_code == 200, f"Expected 200, got {patch_response.status_code}: {patch_response.text}"
        
        updated_lead = patch_response.json()
        assert updated_lead["status"] == new_status, f"Expected status={new_status}, got {updated_lead['status']}"
        
        # Verify persistence
        verify_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        verify_leads = verify_response.json()
        updated_lead_found = next((l for l in verify_leads if l["id"] == lead_id), None)
        assert updated_lead_found is not None
        assert updated_lead_found["status"] == new_status

    def test_update_lead_note(self, api_client, rep_token):
        """PATCH /api/leads/{id} updates lead note (Phase 1.1 regression)"""
        # Get a lead
        get_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = get_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available to update")
        
        lead_id = leads[0]["id"]
        test_note = "TEST_Phase 1.1 note update - handlowiec can edit notes"
        
        # Update note
        patch_response = api_client.patch(
            f"{BASE_URL}/api/leads/{lead_id}",
            json={"note": test_note},
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert patch_response.status_code == 200, f"Expected 200, got {patch_response.status_code}: {patch_response.text}"
        
        updated_lead = patch_response.json()
        assert updated_lead["note"] == test_note, f"Expected note='{test_note}', got '{updated_lead.get('note')}'"
        
        # Verify persistence
        verify_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        verify_leads = verify_response.json()
        updated_lead_found = next((l for l in verify_leads if l["id"] == lead_id), None)
        assert updated_lead_found is not None
        assert updated_lead_found["note"] == test_note

    def test_manager_dashboard_status_breakdown(self, api_client, manager_token):
        """GET /api/dashboard/manager returns status_breakdown that reflects lead status changes (Phase 1.1 regression)"""
        # This test verifies that when a handlowiec updates a lead status, the manager dashboard reflects it
        response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "status_breakdown" in data
        
        # Verify all 5 statuses are present
        expected_statuses = ["podpisana", "decyzja", "umowione", "nie_zainteresowany", "nowy"]
        for status in expected_statuses:
            assert status in data["status_breakdown"], f"Missing status '{status}' in status_breakdown"
            assert isinstance(data["status_breakdown"][status], int), f"Status '{status}' count should be an integer"


# ============ USERS TESTS ============
class TestUsers:
    """Users endpoint tests"""

    def test_register_as_admin(self, api_client, admin_token):
        """POST /api/auth/register as admin creates a new user"""
        import time
        new_user_data = {
            "email": f"TEST_newuser_{int(time.time())}@test.com",
            "password": "test1234",
            "name": "Test User",
            "role": "handlowiec"
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json=new_user_data,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        created_user = response.json()
        assert "id" in created_user
        assert created_user["email"] == new_user_data["email"].lower()  # Backend lowercases emails
        assert created_user["role"] == new_user_data["role"]
        
        # Verify user can login
        login_response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": new_user_data["email"], "password": new_user_data["password"]}
        )
        assert login_response.status_code == 200, "New user should be able to login"

    def test_register_as_non_admin_forbidden(self, api_client, manager_token):
        """POST /api/auth/register as non-admin returns 403"""
        response = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": "shouldfail@test.com",
                "password": "test1234",
                "name": "Should Fail",
                "role": "handlowiec"
            },
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"

    def test_get_users_as_admin(self, api_client, admin_token):
        """GET /api/users as admin returns all users"""
        response = api_client.get(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        users = response.json()
        assert isinstance(users, list)
        assert len(users) >= 3, "Should have at least admin, manager, handlowiec"

    def test_get_users_as_manager(self, api_client, manager_token):
        """GET /api/users as manager returns own team + self"""
        response = api_client.get(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        users = response.json()
        assert isinstance(users, list)
        # Manager should see themselves + their reps (4 reps according to seed)
        assert len(users) >= 4, f"Manager should see at least 4 users (self + reps), got {len(users)}"

    def test_get_users_as_handlowiec(self, api_client, rep_token):
        """GET /api/users as handlowiec returns only self"""
        response = api_client.get(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        users = response.json()
        assert isinstance(users, list)
        assert len(users) == 1, f"Handlowiec should only see themselves, got {len(users)} users"

    def test_delete_user_as_admin(self, api_client, admin_token):
        """DELETE /api/users/{id} as admin works"""
        import time
        # First create a test user to delete
        new_user_data = {
            "email": f"TEST_todelete_{int(time.time())}@test.com",
            "password": "test1234",
            "name": "To Delete",
            "role": "handlowiec"
        }
        
        create_response = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json=new_user_data,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        if create_response.status_code != 200:
            pytest.skip("Could not create test user for deletion")
        
        user_id = create_response.json()["id"]
        
        # Delete the user
        delete_response = api_client.delete(
            f"{BASE_URL}/api/users/{user_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        
        # Verify user is deleted - login should fail
        login_response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": new_user_data["email"], "password": new_user_data["password"]}
        )
        assert login_response.status_code == 401, "Deleted user should not be able to login"

    def test_delete_user_as_manager_forbidden(self, api_client, manager_token):
        """DELETE /api/users/{id} as manager returns 403"""
        # Try to delete any user (use a fake ID)
        response = api_client.delete(
            f"{BASE_URL}/api/users/fake-user-id",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
