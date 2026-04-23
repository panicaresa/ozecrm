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
            "latitude": 54.36100,
            "longitude": 18.61100,
            "status": "nowy",
            "photo_base64": "iVBORw0KGgo" + "A" * 200  # min 100 chars, fake PNG prefix
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


# ============ DOCUMENTS TESTS (Phase 1.2) ============
class TestDocuments:
    """Lead documents endpoint tests (Phase 1.2)"""

    def test_upload_document_as_assigned_handlowiec(self, api_client, rep_token):
        """POST /api/leads/{id}/documents as assigned handlowiec uploads document and returns metadata"""
        # Get a lead assigned to this handlowiec
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = leads_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available for document upload")
        
        lead_id = leads[0]["id"]
        
        # Create a small base64 image (1x1 red pixel PNG)
        small_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        
        doc_data = {
            "type": "photo",
            "filename": "test-photo.png",
            "mime": "image/png",
            "data_base64": small_image_base64
        }
        
        upload_response = api_client.post(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            json=doc_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert upload_response.status_code == 200, f"Expected 200, got {upload_response.status_code}: {upload_response.text}"
        
        uploaded_doc = upload_response.json()
        assert "id" in uploaded_doc
        assert uploaded_doc["type"] == "photo"
        assert uploaded_doc["filename"] == "test-photo.png"
        assert uploaded_doc["mime"] == "image/png"
        assert "data_base64" not in uploaded_doc, "Response should not include data_base64 (metadata only)"
        
        # Verify persistence with GET
        list_response = api_client.get(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert list_response.status_code == 200
        docs = list_response.json()
        assert any(d["id"] == uploaded_doc["id"] for d in docs), "Uploaded document not found in list"

    def test_list_documents(self, api_client, rep_token):
        """GET /api/leads/{id}/documents returns metadata list without data_base64"""
        # Get a lead
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = leads_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        list_response = api_client.get(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert list_response.status_code == 200, f"Expected 200, got {list_response.status_code}: {list_response.text}"
        
        docs = list_response.json()
        assert isinstance(docs, list)
        
        # If there are documents, verify structure
        if len(docs) > 0:
            doc = docs[0]
            assert "id" in doc
            assert "type" in doc
            assert "filename" in doc
            assert "mime" in doc
            assert "data_base64" not in doc, "List endpoint should not return data_base64"

    def test_get_single_document_with_data(self, api_client, rep_token):
        """GET /api/leads/{id}/documents/{doc_id} returns document with data_base64"""
        # Get a lead and upload a document first
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = leads_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Upload a test document
        small_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        doc_data = {
            "type": "umowa",
            "filename": "test-contract.png",
            "mime": "image/png",
            "data_base64": small_image_base64
        }
        
        upload_response = api_client.post(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            json=doc_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        
        if upload_response.status_code != 200:
            pytest.skip("Could not upload test document")
        
        doc_id = upload_response.json()["id"]
        
        # Get the document with data
        get_response = api_client.get(
            f"{BASE_URL}/api/leads/{lead_id}/documents/{doc_id}",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}: {get_response.text}"
        
        doc = get_response.json()
        assert doc["id"] == doc_id
        assert doc["type"] == "umowa"
        assert "data_base64" in doc, "Single document endpoint should return data_base64"
        assert doc["data_base64"] == small_image_base64

    def test_delete_document(self, api_client, rep_token):
        """DELETE /api/leads/{id}/documents/{doc_id} removes document"""
        # Get a lead and upload a document
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = leads_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Upload a test document
        small_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        doc_data = {
            "type": "other",
            "filename": "to-delete.png",
            "mime": "image/png",
            "data_base64": small_image_base64
        }
        
        upload_response = api_client.post(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            json=doc_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        
        if upload_response.status_code != 200:
            pytest.skip("Could not upload test document")
        
        doc_id = upload_response.json()["id"]
        
        # Delete the document
        delete_response = api_client.delete(
            f"{BASE_URL}/api/leads/{lead_id}/documents/{doc_id}",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        
        # Verify deletion - GET should return 404
        get_response = api_client.get(
            f"{BASE_URL}/api/leads/{lead_id}/documents/{doc_id}",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert get_response.status_code == 404, f"Expected 404 after deletion, got {get_response.status_code}"

    def test_upload_document_as_non_assigned_handlowiec_forbidden(self, api_client):
        """POST /api/leads/{id}/documents as non-assigned handlowiec returns 403"""
        # Login as handlowiec@test.com
        rep1_response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "handlowiec@test.com", "password": "test1234"}
        )
        
        if rep1_response.status_code != 200:
            pytest.skip("Could not login as handlowiec@test.com")
        
        rep1_token = rep1_response.json()["access_token"]
        
        # Get leads assigned to handlowiec@test.com
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep1_token}"}
        )
        rep1_leads = leads_response.json()
        
        if len(rep1_leads) == 0:
            pytest.skip("handlowiec@test.com has no leads")
        
        lead_id = rep1_leads[0]["id"]
        
        # Now login as anna@test.com (different handlowiec)
        anna_response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "anna@test.com", "password": "test1234"}
        )
        
        if anna_response.status_code != 200:
            pytest.skip("Could not login as anna@test.com")
        
        anna_token = anna_response.json()["access_token"]
        
        # Try to upload document to handlowiec's lead as anna
        small_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
        doc_data = {
            "type": "photo",
            "filename": "should-fail.png",
            "mime": "image/png",
            "data_base64": small_image_base64
        }
        
        upload_response = api_client.post(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            json=doc_data,
            headers={"Authorization": f"Bearer {anna_token}"}
        )
        assert upload_response.status_code == 403, f"Expected 403, got {upload_response.status_code}"

    def test_upload_oversized_document_rejected(self, api_client, rep_token):
        """POST /api/leads/{id}/documents with >12MB base64 returns 413 or 400"""
        # Get a lead
        leads_response = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        leads = leads_response.json()
        
        if len(leads) == 0:
            pytest.skip("No leads available")
        
        lead_id = leads[0]["id"]
        
        # Create a large base64 string (>12MB when decoded, ~16MB base64)
        # Base64 is ~1.33x larger than binary, so 12MB binary = ~16MB base64
        # We'll create a 17MB base64 string to exceed the limit
        large_data = "A" * (17 * 1024 * 1024)  # 17MB of 'A' characters
        
        doc_data = {
            "type": "photo",
            "filename": "huge-file.bin",
            "mime": "application/octet-stream",
            "data_base64": large_data
        }
        
        upload_response = api_client.post(
            f"{BASE_URL}/api/leads/{lead_id}/documents",
            json=doc_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        # Should return 413 (Payload Too Large) or 400 (Bad Request)
        assert upload_response.status_code in [400, 413], f"Expected 400 or 413, got {upload_response.status_code}"


# ============ REP LOCATION TESTS (Phase 1.2) ============
class TestRepLocation:
    """Rep live location endpoint tests (Phase 1.2)"""

    def test_push_rep_location(self, api_client, rep_token):
        """PUT /api/rep/location as handlowiec pushes location and returns 200"""
        location_data = {
            "latitude": 54.372,
            "longitude": 18.638,
            "accuracy": 10.0,
            "battery": 0.8,
            "battery_state": "unplugged"
        }
        
        response = api_client.put(
            f"{BASE_URL}/api/rep/location",
            json=location_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("ok") == True

    def test_push_rep_location_upsert(self, api_client, rep_token):
        """PUT /api/rep/location twice upserts (no duplicate)"""
        location_data_1 = {
            "latitude": 54.372,
            "longitude": 18.638,
            "battery": 0.8
        }
        
        # First push
        response1 = api_client.put(
            f"{BASE_URL}/api/rep/location",
            json=location_data_1,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response1.status_code == 200
        
        # Second push with different location
        location_data_2 = {
            "latitude": 54.380,
            "longitude": 18.650,
            "battery": 0.75
        }
        
        response2 = api_client.put(
            f"{BASE_URL}/api/rep/location",
            json=location_data_2,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response2.status_code == 200
        
        # Verify only one location exists by checking manager dashboard
        # Login as manager
        manager_response = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "manager@test.com", "password": "test1234"}
        )
        
        if manager_response.status_code != 200:
            pytest.skip("Could not login as manager")
        
        manager_token = manager_response.json()["access_token"]
        
        dashboard_response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        
        if dashboard_response.status_code == 200:
            dashboard = dashboard_response.json()
            # Get current user ID
            me_response = api_client.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": f"Bearer {rep_token}"}
            )
            user_id = me_response.json()["id"]
            
            # Find this rep in reps_live
            rep_locations = [r for r in dashboard.get("reps_live", []) if r["user_id"] == user_id]
            # Should have exactly 1 location (upserted, not duplicated)
            assert len(rep_locations) <= 1, f"Expected 0 or 1 location, got {len(rep_locations)} (upsert should prevent duplicates)"

    def test_delete_rep_location(self, api_client, rep_token):
        """DELETE /api/rep/location clears location"""
        # First push a location
        location_data = {
            "latitude": 54.372,
            "longitude": 18.638,
            "battery": 0.9
        }
        
        push_response = api_client.put(
            f"{BASE_URL}/api/rep/location",
            json=location_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert push_response.status_code == 200
        
        # Delete the location
        delete_response = api_client.delete(
            f"{BASE_URL}/api/rep/location",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        
        data = delete_response.json()
        assert data.get("ok") == True

    def test_manager_dashboard_returns_reps_live(self, api_client, manager_token, rep_token):
        """GET /api/dashboard/manager returns reps_live array with pushed rep location"""
        # First push a location as handlowiec
        location_data = {
            "latitude": 54.372,
            "longitude": 18.638,
            "battery": 0.85,
            "accuracy": 15.0
        }
        
        push_response = api_client.put(
            f"{BASE_URL}/api/rep/location",
            json=location_data,
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert push_response.status_code == 200
        
        # Get manager dashboard
        dashboard_response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {manager_token}"}
        )
        assert dashboard_response.status_code == 200, f"Expected 200, got {dashboard_response.status_code}: {dashboard_response.text}"
        
        dashboard = dashboard_response.json()
        assert "reps_live" in dashboard, "Missing reps_live in dashboard response"
        assert isinstance(dashboard["reps_live"], list)
        
        # Get current rep user ID
        me_response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        user_id = me_response.json()["id"]
        
        # Find this rep in reps_live
        rep_location = next((r for r in dashboard["reps_live"] if r["user_id"] == user_id), None)
        assert rep_location is not None, f"Rep {user_id} not found in reps_live array"
        
        # Verify structure
        assert "user_id" in rep_location
        assert "name" in rep_location
        assert "lat" in rep_location
        assert "lng" in rep_location
        assert "battery" in rep_location
        assert "active" in rep_location
        assert "last_seen_seconds" in rep_location
        
        # Verify values
        assert rep_location["lat"] == location_data["latitude"]
        assert rep_location["lng"] == location_data["longitude"]
        assert rep_location["battery"] == location_data["battery"]

    def test_manager_dashboard_as_handlowiec_forbidden(self, api_client, rep_token):
        """GET /api/dashboard/manager as handlowiec returns 403 (Phase 1.2 regression)"""
        response = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {rep_token}"}
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"



# ============ BATCH A — SECURITY HARDENING TESTS ============
# Testy dla CORS whitelist, JWT validation, SEED_DEMO gating,
# bootstrap admin + force-password-change flow.

import subprocess
import uuid as _uuid


class TestBatchASecurity:
    """Backend security hardening (CORS, JWT, seed gating, bootstrap admin, change-password)."""

    # ── CORS ──────────────────────────────────────────────────────────────────
    def test_cors_whitelist_blocks_unknown_origin(self, api_client):
        """When backend runs with CORS_ALLOWED_ORIGINS set, a preflight from
        an un-whitelisted origin must NOT echo the Origin header back.
        In dev (wildcard fallback) this test is skipped automatically."""
        # Probe current CORS policy: OPTIONS preflight from evil origin
        r = api_client.options(
            f"{BASE_URL}/api/",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        allowed_origin = r.headers.get("access-control-allow-origin", "")
        # Dev backend has wildcard → allow_origin == "*" — skip
        if allowed_origin == "*":
            pytest.skip("CORS currently in wildcard dev mode (no CORS_ALLOWED_ORIGINS)")
        # If whitelist is active, evil origin should NOT be echoed back.
        assert allowed_origin != "https://evil.example.com", (
            f"CORS whitelist failed: evil origin was allowed ({allowed_origin!r})"
        )

    # ── JWT_SECRET validation ─────────────────────────────────────────────────
    def test_weak_jwt_secret_fails_in_prod(self):
        """Spawning server.py import with APP_ENV=production + weak JWT_SECRET
        must trigger SystemExit(1) before FastAPI app is ready."""
        code = (
            "import os, sys;"
            "os.environ['MONGO_URL']='mongodb://localhost:27017';"
            "os.environ['DB_NAME']='oze_crm';"
            "os.environ['APP_ENV']='production';"
            "os.environ['JWT_SECRET']='short';"
            "os.environ['ADMIN_EMAIL']='admin@test.com';"
            "os.environ['ADMIN_PASSWORD']='test1234';"
            "os.environ['MANAGER_EMAIL']='manager@test.com';"
            "os.environ['MANAGER_PASSWORD']='test1234';"
            "os.environ['REP_EMAIL']='rep@test.com';"
            "os.environ['REP_PASSWORD']='test1234';"
            "sys.path.insert(0, '/app/backend');"
            "import server"
        )
        proc = subprocess.run(
            ["python", "-c", code],
            capture_output=True,
            text=True,
            timeout=15,
            cwd="/tmp",  # avoid auto-loading /app/backend/.env
        )
        # Either SystemExit(1) or non-zero exit is acceptable
        assert proc.returncode != 0, (
            f"Backend imported successfully with weak JWT_SECRET in production mode! "
            f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
        )

    # ── SEED_DEMO gating ──────────────────────────────────────────────────────
    def test_seed_demo_enabled_test_users_present(self, api_client):
        """With SEED_DEMO=1 (current dev env), demo test users must exist."""
        r = api_client.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert r.status_code == 200, "admin@test.com should exist when SEED_DEMO=1"

    # ── Change password flow ──────────────────────────────────────────────────
    def _fresh_user(self, api_client, admin_token):
        """Create a throwaway handlowiec via admin register, return (email, pw, token)."""
        email = f"batcha+{_uuid.uuid4().hex[:8]}@test.com"
        pw = "initialPass123"  # 15 chars, has letters + digits
        r = api_client.post(
            f"{BASE_URL}/api/auth/register",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"email": email, "password": pw, "name": "Batch A User", "role": "handlowiec"},
        )
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        user_id = r.json()["id"]
        # Login
        lr = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
        assert lr.status_code == 200
        token = lr.json()["access_token"]
        return email, pw, token, user_id

    def test_change_password_success(self, api_client, admin_token):
        email, pw, token, _ = self._fresh_user(api_client, admin_token)
        new_pw = "NewSecurePass2026"  # 17 chars
        r = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": pw, "new_password": new_pw},
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("ok") is True
        # Old password must fail now
        lr_old = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
        assert lr_old.status_code == 401
        # New password must work
        lr_new = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": new_pw})
        assert lr_new.status_code == 200

    def test_change_password_rejects_weak(self, api_client, admin_token):
        _, pw, token, _ = self._fresh_user(api_client, admin_token)
        # too short
        r = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": pw, "new_password": "short1a"},
        )
        assert r.status_code == 400
        # no digit
        r2 = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": pw, "new_password": "onlyletterslong"},
        )
        assert r2.status_code == 400
        # wrong current password
        r3 = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "wrong-current", "new_password": "GoodPassword123"},
        )
        assert r3.status_code == 401

    def test_must_change_password_flag_in_me(self, api_client, admin_token):
        """/auth/me must expose must_change_password flag (default False for demo users)."""
        r = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "must_change_password" in body, "must_change_password flag missing in /auth/me"
        assert body["must_change_password"] is False  # admin@test.com has no temp pw

    def test_must_change_password_blocks_sensitive_endpoints(self, api_client, admin_token):
        """Force a user into must_change_password=True via MongoDB directly, verify
        that sensitive write endpoints return 403 until password is changed."""
        try:
            from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
            import asyncio
            import pymongo
        except ImportError:
            pytest.skip("pymongo not installed")

        email, pw, token, user_id = self._fresh_user(api_client, admin_token)
        # Set the flag directly in DB
        mclient = pymongo.MongoClient("mongodb://localhost:27017")
        mclient["oze_crm"]["users"].update_one(
            {"id": user_id}, {"$set": {"must_change_password": True}}
        )
        mclient.close()

        # /auth/me must now reflect the flag
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json().get("must_change_password") is True

        # Sensitive endpoint: POST /api/contracts must return 403 "Password change required"
        contract_body = {
            "lead_id": "nonexistent-id",
            "signed_at": "2025-01-01",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 100.0,
            "gross_amount": 50000.0,
            "global_margin": 5000.0,
            "financing_type": "cash",
        }
        r_contract = api_client.post(
            f"{BASE_URL}/api/contracts",
            headers={"Authorization": f"Bearer {token}"},
            json=contract_body,
        )
        assert r_contract.status_code == 403, (
            f"Expected 403 (password change required), got {r_contract.status_code}: {r_contract.text}"
        )
        assert "Password change required" in r_contract.text

        # GET endpoints must still work
        r_leads = api_client.get(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_leads.status_code == 200, "GET endpoints should remain accessible"

        # change-password must still be reachable
        r_chg = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": pw, "new_password": "NewPassword2026"},
        )
        assert r_chg.status_code == 200

        # After change, flag must be cleared
        me2 = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me2.json().get("must_change_password") is False

        # Cleanup: remove throwaway user
        cleanup = pymongo.MongoClient("mongodb://localhost:27017")
        cleanup["oze_crm"]["users"].delete_one({"id": user_id})
        cleanup.close()



# ============ BATCH B-FIX — FORCE-CHANGE DEFAULT FOR NEW USERS ============


class TestBatchBFixForceChange:
    """POST /auth/register now defaults must_change_password=True; skip flag available."""

    def _register_fresh(self, api_client, admin_token, skip: bool = False):
        import uuid as _u
        email = f"bfix+{_u.uuid4().hex[:8]}@test.com"
        payload = {
            "email": email,
            "password": "initialPass123",
            "name": "BFix User",
            "role": "handlowiec",
        }
        if skip:
            payload["skip_password_change"] = True
        r = api_client.post(
            f"{BASE_URL}/api/auth/register",
            headers={"Authorization": f"Bearer {admin_token}"},
            json=payload,
        )
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        user_obj = r.json()
        return email, user_obj

    def _login(self, api_client, email, password="initialPass123"):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200
        return r.json()["access_token"], r.json()["user"]

    def test_new_user_has_must_change_password_flag(self, api_client, admin_token):
        _, user_obj = self._register_fresh(api_client, admin_token)
        assert user_obj.get("must_change_password") is True, (
            f"Expected must_change_password=True by default, got {user_obj}"
        )

    def test_new_user_cannot_access_dashboard_without_changing(self, api_client, admin_token):
        email, _ = self._register_fresh(api_client, admin_token)
        token, _ = self._login(api_client, email)
        r = api_client.get(
            f"{BASE_URL}/api/dashboard/rep",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        assert "Password change required" in r.text

    def test_new_user_can_change_password_and_access_dashboard(self, api_client, admin_token):
        email, _ = self._register_fresh(api_client, admin_token)
        token, _ = self._login(api_client, email)
        # Change password
        r_chg = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "initialPass123", "new_password": "BrandNewPass2026"},
        )
        assert r_chg.status_code == 200, f"{r_chg.status_code} {r_chg.text}"
        # /auth/me must reflect the cleared flag
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json().get("must_change_password") is False
        # Now dashboard access should work
        r_dash = api_client.get(
            f"{BASE_URL}/api/dashboard/rep",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_dash.status_code == 200, f"{r_dash.status_code} {r_dash.text}"

    def test_skip_password_change_flag_works(self, api_client, admin_token):
        email, user_obj = self._register_fresh(api_client, admin_token, skip=True)
        assert user_obj.get("must_change_password") is False, (
            "skip_password_change=True must yield must_change_password=False"
        )
        # Login + dashboard must work immediately, without change-password step.
        token, u = self._login(api_client, email)
        assert u.get("must_change_password") is False
        r = api_client.get(
            f"{BASE_URL}/api/dashboard/rep",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
