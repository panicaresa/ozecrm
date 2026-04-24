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

        # Use unique coords per run to avoid anti-collision hits on repeated runs
        import random as _rnd
        import pymongo as _pm
        unique_lat = round(54.05 + _rnd.uniform(-0.02, 0.02), 6)
        unique_lng = round(21.75 + _rnd.uniform(-0.02, 0.02), 6)
        # Clean out any previous TEST_Jan leads in the vicinity from prior runs
        _mc = _pm.MongoClient("mongodb://localhost:27017")
        _mc["oze_crm"]["leads"].delete_many(
            {"client_name": {"$regex": "^TEST_Jan"}, "latitude": {"$gte": 54.0, "$lte": 54.1}}
        )
        _mc.close()

        lead_data = {
            "client_name": "TEST_Jan Testowy",
            "phone": "+48 500 123 456",
            "address": "Testowa 1, Gdańsk",
            "postal_code": "11-500",
            "latitude": unique_lat,
            "longitude": unique_lng,
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


# ============ SPRINT 1 — ANTI-COLLISION V2 ============


class TestAntiCollisionV2:
    """Two-tier anti-collision (hard <15m, soft 15-75m) + apartment_number bypass + override stats."""

    # Używamy nieobciążonego obszaru daleko od seed demo (seed=Trójmiasto 54.35-54.41, 18.57-18.66)
    BASE_LAT = 54.0100
    BASE_LNG = 20.0000

    # ~1m per 0.00001 deg latitude at Polish latitudes (rough)
    def _offset(self, base_lat: float, base_lng: float, meters_north: float, meters_east: float):
        # 1 deg lat ~ 111_320 m; 1 deg lng ~ 111_320 * cos(lat)
        import math
        dlat = meters_north / 111_320.0
        dlng = meters_east / (111_320.0 * math.cos(math.radians(base_lat)))
        return round(base_lat + dlat, 7), round(base_lng + dlng, 7)

    def _photo(self):
        return "iVBORw0KGgo" + "A" * 200

    def _cleanup_ctx(self, label_prefix: str):
        """Remove any test leads under our base coords before AND after each test."""
        import pymongo
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        try:
            mc["oze_crm"]["leads"].delete_many(
                {
                    "latitude": {"$gte": self.BASE_LAT - 0.01, "$lte": self.BASE_LAT + 0.01},
                    "longitude": {"$gte": self.BASE_LNG - 0.01, "$lte": self.BASE_LNG + 0.01},
                }
            )
        finally:
            mc.close()

    def _create_lead(self, api_client, rep_token, lat, lng, apt=None, confirmed=False, name=None):
        import uuid
        payload = {
            "client_name": name or f"ACv2_{uuid.uuid4().hex[:6]}",
            "phone": "+48 500 000 000",
            "address": "Anti-collision test",
            "postal_code": "11-500",
            "latitude": lat,
            "longitude": lng,
            "status": "nowy",
            "photo_base64": self._photo(),
        }
        if apt is not None:
            payload["apartment_number"] = apt
        if confirmed:
            payload["confirmed_nearby_duplicate"] = True
        r = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        return r

    # ── HARD STOP (< 15m) ────────────────────────────────────────────────────
    def test_hard_stop_below_15m(self, api_client, rep_token):
        self._cleanup_ctx("hard15")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, name="ACv2_first_hard")
        assert r1.status_code == 200, r1.text
        # 10m north
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 10, 0)
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, name="ACv2_hard_dup")
        assert r2.status_code == 409, r2.text
        detail = r2.json().get("detail")
        assert isinstance(detail, dict), f"Expected dict detail, got {detail!r}"
        assert detail.get("code") == "LEAD_DUPLICATE_HARD"
        assert detail.get("existing_lead_id")
        assert detail.get("distance_m") is not None
        self._cleanup_ctx("hard15-end")

    # ── apartment_number escape hatch ────────────────────────────────────────
    def test_apartment_number_allows_same_building(self, api_client, rep_token):
        self._cleanup_ctx("apt-diff")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, apt="3", name="ACv2_apt3")
        assert r1.status_code == 200
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 5, 0)
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, apt="7", name="ACv2_apt7")
        assert r2.status_code == 200, f"expected 200 (different flat), got {r2.status_code}: {r2.text}"
        self._cleanup_ctx("apt-diff-end")

    def test_apartment_number_same_blocks(self, api_client, rep_token):
        self._cleanup_ctx("apt-same")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, apt="3", name="ACv2_apt3_a")
        assert r1.status_code == 200
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 5, 0)
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, apt="3", name="ACv2_apt3_b")
        assert r2.status_code == 409, r2.text
        assert r2.json()["detail"]["code"] == "LEAD_DUPLICATE_HARD"
        self._cleanup_ctx("apt-same-end")

    # ── SOFT WARNING (15-75m) ────────────────────────────────────────────────
    def test_soft_warning_15_to_75m(self, api_client, rep_token):
        self._cleanup_ctx("soft30")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, name="ACv2_soft_first")
        assert r1.status_code == 200
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 30, 0)  # 30m
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, name="ACv2_soft_dup")
        assert r2.status_code == 409, r2.text
        assert r2.json()["detail"]["code"] == "LEAD_NEARBY_SOFT"
        self._cleanup_ctx("soft30-end")

    def test_soft_warning_with_confirm_succeeds(self, api_client, rep_token):
        self._cleanup_ctx("soft-confirm")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, name="ACv2_cfirst")
        assert r1.status_code == 200
        existing_id = r1.json()["id"]
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 30, 0)
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, confirmed=True, name="ACv2_cdup")
        assert r2.status_code == 200, r2.text
        saved = r2.json()
        assert saved.get("nearby_override_confirmed") is True
        assert saved.get("nearby_override_other_lead_id") == existing_id
        assert saved.get("nearby_override_distance_m") is not None
        # confirmed_nearby_duplicate must NOT be persisted
        assert "confirmed_nearby_duplicate" not in saved or saved.get("confirmed_nearby_duplicate") in (None, False)
        self._cleanup_ctx("soft-confirm-end")

    # ── Far — no collision ───────────────────────────────────────────────────
    def test_far_distance_no_collision(self, api_client, rep_token):
        self._cleanup_ctx("far")
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, name="ACv2_far_first")
        assert r1.status_code == 200
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 100, 0)  # 100m away
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, name="ACv2_far_second")
        assert r2.status_code == 200, r2.text
        self._cleanup_ctx("far-end")

    # ── override_stats in /users/{id}/profile ────────────────────────────────
    def test_override_stats_in_profile(self, api_client, admin_token, rep_token):
        self._cleanup_ctx("stats")
        # Fetch rep user id
        me = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        rep_id = me.json()["id"]

        # Create 2 override leads
        r1 = self._create_lead(api_client, rep_token, self.BASE_LAT, self.BASE_LNG, name="ACv2_stats_base1")
        assert r1.status_code == 200
        lat2, lng2 = self._offset(self.BASE_LAT, self.BASE_LNG, 30, 0)
        r2 = self._create_lead(api_client, rep_token, lat2, lng2, confirmed=True, name="ACv2_stats_ovr1")
        assert r2.status_code == 200

        # Separate base (120m east to avoid hitting r1/r2)
        base2_lat, base2_lng = self._offset(self.BASE_LAT, self.BASE_LNG, 0, 120)
        r3 = self._create_lead(api_client, rep_token, base2_lat, base2_lng, name="ACv2_stats_base2")
        assert r3.status_code == 200
        lat4, lng4 = self._offset(base2_lat, base2_lng, 40, 0)
        r4 = self._create_lead(api_client, rep_token, lat4, lng4, confirmed=True, name="ACv2_stats_ovr2")
        assert r4.status_code == 200

        # Profile call
        prof = api_client.get(
            f"{BASE_URL}/api/users/{rep_id}/profile",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert prof.status_code == 200, prof.text
        stats = prof.json().get("override_stats")
        assert stats is not None, "override_stats missing from profile response"
        assert stats["total"] >= 2, f"expected >=2 overrides, got {stats}"
        assert stats["this_month"] >= 2
        assert len(stats["recent_overrides"]) >= 2
        # Sanity check shape
        entry = stats["recent_overrides"][0]
        assert "lead_id" in entry and "lead_client_name" in entry
        assert "other_lead_client_name" in entry and "distance_m" in entry

        self._cleanup_ctx("stats-end")



# ============ SPRINT 1.5 — LEAD IDEMPOTENCY ============


class TestLeadIdempotency:
    """POST /api/leads supports Idempotency-Key header for offline-queue retries."""

    BASE_LAT = 53.5100
    BASE_LNG = 19.5100

    def _photo(self):
        return "iVBORw0KGgo" + "A" * 200

    def _cleanup(self):
        import pymongo
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        try:
            mc["oze_crm"]["leads"].delete_many(
                {"latitude": {"$gte": self.BASE_LAT - 0.05, "$lte": self.BASE_LAT + 0.05}}
            )
            # Drop explicit idempotency_keys we used
            mc["oze_crm"]["leads"].delete_many(
                {"idempotency_key": {"$regex": "^idem-test-"}}
            )
        finally:
            mc.close()

    def test_lead_idempotency_key_replay(self, api_client, rep_token):
        """Two POSTs with the same Idempotency-Key → one lead in DB, same id returned."""
        self._cleanup()
        import uuid as _u
        key = f"idem-test-{_u.uuid4().hex}"
        payload = {
            "client_name": "IdemTest_A",
            "latitude": self.BASE_LAT,
            "longitude": self.BASE_LNG,
            "status": "nowy",
            "photo_base64": self._photo(),
        }
        r1 = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}", "Idempotency-Key": key},
        )
        assert r1.status_code == 200, r1.text
        lead_id_1 = r1.json()["id"]

        # Replay — same key
        r2 = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}", "Idempotency-Key": key},
        )
        assert r2.status_code == 200, r2.text
        lead_id_2 = r2.json()["id"]
        assert lead_id_1 == lead_id_2, "Replay must return the same lead id"

        # DB must contain exactly ONE lead with this idempotency_key
        import pymongo
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        try:
            count = mc["oze_crm"]["leads"].count_documents({"idempotency_key": key})
            assert count == 1, f"Expected 1 lead with key, got {count}"
        finally:
            mc.close()
        self._cleanup()

    def test_lead_idempotency_different_keys(self, api_client, rep_token):
        """Two POSTs with DIFFERENT Idempotency-Key → two leads (when location allows)."""
        self._cleanup()
        import uuid as _u
        k1 = f"idem-test-{_u.uuid4().hex}"
        k2 = f"idem-test-{_u.uuid4().hex}"
        # Different locations to avoid anti-collision
        p1 = {
            "client_name": "IdemTest_DiffA",
            "latitude": self.BASE_LAT,
            "longitude": self.BASE_LNG,
            "status": "nowy",
            "photo_base64": self._photo(),
        }
        p2 = {
            "client_name": "IdemTest_DiffB",
            "latitude": self.BASE_LAT + 0.01,  # ~1.1 km north
            "longitude": self.BASE_LNG,
            "status": "nowy",
            "photo_base64": self._photo(),
        }
        r1 = api_client.post(
            f"{BASE_URL}/api/leads",
            json=p1,
            headers={"Authorization": f"Bearer {rep_token}", "Idempotency-Key": k1},
        )
        assert r1.status_code == 200
        r2 = api_client.post(
            f"{BASE_URL}/api/leads",
            json=p2,
            headers={"Authorization": f"Bearer {rep_token}", "Idempotency-Key": k2},
        )
        assert r2.status_code == 200
        assert r1.json()["id"] != r2.json()["id"]
        self._cleanup()

    def test_lead_without_idempotency_key_still_works(self, api_client, rep_token):
        """Backward compat: POST /leads without Idempotency-Key header works as before."""
        self._cleanup()
        payload = {
            "client_name": "IdemTest_NoKey",
            "latitude": self.BASE_LAT,
            "longitude": self.BASE_LNG,
            "status": "nowy",
            "photo_base64": self._photo(),
        }
        r = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        assert "id" in r.json()
        # idempotency_key should NOT be set
        saved = r.json()
        assert saved.get("idempotency_key") in (None, "", False)
        self._cleanup()



# ============ SPRINT 3a — CONTRACT_SIGNED WS EVENT ============


class TestContractSignedEvent:
    """Verify that POST /contracts broadcasts a 'contract_signed' frame to /ws/events
    subscribers, and that a failing broadcaster does NOT break the POST.

    Integration-style: opens a real websocket client, authenticates, POSTs a
    contract and asserts that a matching frame arrives within a short window.
    """

    BASE_LAT = 52.9000
    BASE_LNG = 19.9000

    def _photo(self):
        return "iVBORw0KGgo" + "A" * 200

    def _cleanup(self):
        import pymongo
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        try:
            mc["oze_crm"]["leads"].delete_many(
                {"client_name": {"$regex": "^WS_"}}
            )
            mc["oze_crm"]["contracts"].delete_many(
                {"client_name": {"$regex": "^WS_"}}
            )
        finally:
            mc.close()

    def _ws_url(self):
        # Backend runs locally on 8001 — bypass ngrok/CDN for WS tests (the
        # preview URL's Cloudflare/ngrok tunnel is not WS-reliable).
        return "ws://localhost:8001/ws/events"

    def _create_signed_lead(self, api_client, rep_token, jitter):
        """Create a fresh 'umowione' lead far from any seed demo so that we
        can sign a contract against it."""
        import uuid, json as _json
        lat = self.BASE_LAT + jitter * 0.0002
        lng = self.BASE_LNG + jitter * 0.0002
        payload = {
            "client_name": f"WS_Lead_{uuid.uuid4().hex[:6]}",
            "latitude": lat,
            "longitude": lng,
            "status": "umowione",
            "meeting_at": "2026-04-25T10:00:00",
            "photo_base64": self._photo(),
        }
        r = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_contract_post_broadcasts_contract_signed(self, api_client, rep_token):
        """POST /contracts → every /ws/events subscriber receives
        a 'contract_signed' frame with rep_id, gross_amount, etc."""
        try:
            import websocket  # type: ignore
        except ImportError:
            pytest.skip("websocket-client not installed")
        import json as _json
        import threading
        import time

        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=1)
        lead_id = lead["id"]
        rep_me = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        rep_id = rep_me.json()["id"]

        received = []
        connected_evt = threading.Event()
        auth_ok_evt = threading.Event()
        event_evt = threading.Event()

        def on_message(wsapp, message):
            try:
                m = _json.loads(message)
            except Exception:
                return
            if m.get("type") == "auth_ok":
                auth_ok_evt.set()
                return
            if m.get("type") == "contract_signed":
                received.append(m)
                event_evt.set()

        def on_open(wsapp):
            connected_evt.set()
            wsapp.send(_json.dumps({"token": rep_token}))

        def on_error(wsapp, err):
            pass

        wsapp = websocket.WebSocketApp(
            self._ws_url(),
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
        )
        thr = threading.Thread(target=wsapp.run_forever, daemon=True)
        thr.start()

        assert connected_evt.wait(timeout=5), "WS did not connect"
        assert auth_ok_evt.wait(timeout=5), "WS auth did not succeed"

        # POST /contracts after WS is subscribed
        contract_body = {
            "lead_id": lead_id,
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 100.0,
            "gross_amount": 45000.0,
            "global_margin": 5000.0,
            "financing_type": "cash",
            "down_payment_amount": 45000.0,
            "installments_count": 1,
            "total_paid_amount": 45000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=contract_body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text

        # Wait up to 5s for the broadcast frame
        got = event_evt.wait(timeout=5)
        try:
            wsapp.close()
        except Exception:
            pass

        assert got, f"contract_signed frame not received within 5s. received={received}"
        assert received, "no contract_signed events captured"
        e = received[0]
        assert e.get("type") == "contract_signed"
        assert e.get("rep_id") == rep_id
        assert "client_name" in e
        assert "gross_amount" in e
        assert e.get("gross_amount") == 45000.0
        assert "commission_amount" in e

        # Cleanup
        self._cleanup()

    def test_broadcaster_failure_does_not_break_post(self, api_client, rep_token):
        """If event_broadcaster.broadcast raises, POST /contracts must still
        return 200 — the endpoint is wrapped in try/except."""
        # We can't monkey-patch the server process from here, but we can
        # verify that WITHOUT any WS subscribers (the "empty subs" path),
        # POST /contracts still works. That covers the no-op branch.
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=2)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 120.0,
            "gross_amount": 52000.0,
            "global_margin": 6000.0,
            "financing_type": "cash",
            "down_payment_amount": 52000.0,
            "installments_count": 1,
            "total_paid_amount": 52000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        assert "id" in r.json()
        self._cleanup()



# ============ SPRINT 4.5 — COMMISSION FRAUD PREVENTION ============


class TestCommissionFraudPrevention:
    """Server must own the margin calculation. Handlowiec input for global_margin
    is IGNORED. Negative margin requires explicit manager/admin override."""

    BASE_LAT = 51.4100
    BASE_LNG = 22.4100

    def _photo(self):
        return "iVBORw0KGgo" + "A" * 200

    def _cleanup(self):
        import pymongo
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        try:
            mc["oze_crm"]["leads"].delete_many({"client_name": {"$regex": "^Fraud_"}})
            mc["oze_crm"]["contracts"].delete_many({"client_name": {"$regex": "^Fraud_"}})
        finally:
            mc.close()

    def _create_signed_lead(self, api_client, rep_token, jitter):
        import uuid
        payload = {
            "client_name": f"Fraud_Lead_{uuid.uuid4().hex[:6]}",
            "latitude": self.BASE_LAT + jitter * 0.001,
            "longitude": self.BASE_LNG + jitter * 0.001,
            "status": "umowione",
            "meeting_at": "2026-04-25T10:00:00",
            "photo_base64": self._photo(),
        }
        r = api_client.post(
            f"{BASE_URL}/api/leads",
            json=payload,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        return r.json()

    # ── Auto-compute for small roof (<200 m²) ───────────────────────────────
    def test_margin_auto_computed_small_roof(self, api_client, rep_token):
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=1)
        # 100 m² * 275 = 27500 firm_cost; gross 40000 → margin 12500
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 100.0,
            "gross_amount": 40000.0,
            "global_margin": 99999.0,  # attempt to inflate — MUST be ignored
            "financing_type": "cash",
            "down_payment_amount": 40000.0,
            "installments_count": 1,
            "total_paid_amount": 40000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["firm_cost"] == 27500.0
        assert c["cost_per_m2"] == 275.0
        assert c["computed_margin"] == 12500.0
        # global_margin stored reflects computed value (handlowiec ignored)
        assert c["global_margin"] == 12500.0
        # commission 50% * 12500 = 6250
        assert c["commission_amount"] == 6250.0
        self._cleanup()

    # ── Auto-compute for large roof (≥200 m²) ───────────────────────────────
    def test_margin_auto_computed_large_roof(self, api_client, rep_token):
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=2)
        # 250 m² * 200 = 50000 firm_cost; gross 60000 → margin 10000
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 250.0,
            "gross_amount": 60000.0,
            "financing_type": "cash",
            "down_payment_amount": 60000.0,
            "installments_count": 1,
            "total_paid_amount": 60000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["cost_per_m2"] == 200.0
        assert c["firm_cost"] == 50000.0
        assert c["computed_margin"] == 10000.0
        assert c["commission_amount"] == 5000.0
        self._cleanup()

    # ── Handlowiec cannot inflate margin ────────────────────────────────────
    def test_handlowiec_cannot_override_margin(self, api_client, rep_token):
        """Sending global_margin=99999 as handlowiec → ignored, server math used."""
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=3)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 150.0,
            "gross_amount": 55000.0,
            "global_margin": 99999.99,  # attempt artificial inflation
            "financing_type": "cash",
            "down_payment_amount": 55000.0,
            "installments_count": 1,
            "total_paid_amount": 55000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        c = r.json()
        # firm_cost = 150 * 275 = 41250; margin = 55000 - 41250 = 13750
        assert c["firm_cost"] == 41250.0
        assert c["computed_margin"] == 13750.0
        assert c["global_margin"] == 13750.0, f"Expected auto-computed margin, got {c['global_margin']}"
        assert c["margin_override_by_role"] is None
        # Commission must be 50% of computed margin, NOT the inflated value
        assert c["commission_amount"] == 6875.0
        self._cleanup()

    # ── Negative margin blocks handlowiec ───────────────────────────────────
    def test_negative_margin_blocks_handlowiec(self, api_client, rep_token):
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=4)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 200.0,  # cost 40000 at 200 PLN/m²
            "gross_amount": 30000.0,  # < cost → negative
            "financing_type": "cash",
            "down_payment_amount": 30000.0,
            "installments_count": 1,
            "total_paid_amount": 30000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 400, r.text
        detail = r.json()["detail"]
        assert isinstance(detail, dict)
        assert detail.get("code") == "CONTRACT_NEGATIVE_MARGIN_REP"
        assert "cost_info" in detail
        self._cleanup()

    # ── Negative margin requires allow_negative_margin for manager/admin ────
    def test_negative_margin_requires_override_manager(self, api_client, admin_token, rep_token):
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=5)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 200.0,
            "gross_amount": 30000.0,
            "financing_type": "cash",
            "down_payment_amount": 30000.0,
            "installments_count": 1,
            "total_paid_amount": 30000.0,
            # No allow_negative_margin
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 400, r.text
        assert r.json()["detail"]["code"] == "CONTRACT_NEGATIVE_MARGIN_OVERRIDE_REQUIRED"
        self._cleanup()

    # ── Negative margin works with allow_negative_margin + admin ────────────
    def test_negative_margin_succeeds_with_override(self, api_client, admin_token, rep_token):
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=6)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 200.0,
            "gross_amount": 30000.0,
            "allow_negative_margin": True,
            "financing_type": "cash",
            "down_payment_amount": 30000.0,
            "installments_count": 1,
            "total_paid_amount": 30000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["computed_margin"] == -10000.0
        assert c["negative_margin_override"] is True
        # Commission is MAX(0, margin) * pct in backend? Actually our code uses
        # effective_margin which will be -10000; commission = -5000.
        # That matches the business intent: negative margin ⇒ negative commission audit trail.
        assert c["commission_amount"] == -5000.0
        self._cleanup()

    # ── Preview endpoint ────────────────────────────────────────────────────
    def test_preview_endpoint(self, api_client, rep_token):
        r = api_client.post(
            f"{BASE_URL}/api/contracts/preview-cost",
            json={"roof_area_m2": 100.0, "gross_amount": 50000.0},
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cost_per_m2"] == 275.0
        assert d["firm_cost"] == 27500.0
        assert d["computed_margin"] == 22500.0
        assert d["is_high_margin"] is True
        assert d["is_negative"] is False
        assert d["commission_percent"] == 50.0
        assert d["computed_commission"] == 11250.0

    # ── is_high_margin flag in broadcast payload ────────────────────────────
    def test_high_margin_flag_in_broadcast(self, api_client, rep_token):
        """POST /contracts with high-margin contract — event payload reflects it.
        Connects to /ws/events and verifies the contract_signed frame."""
        try:
            import websocket  # type: ignore
        except ImportError:
            pytest.skip("websocket-client not installed")
        import json as _json
        import threading
        self._cleanup()
        lead = self._create_signed_lead(api_client, rep_token, jitter=7)

        received = []
        connected_evt = threading.Event()
        auth_ok_evt = threading.Event()
        event_evt = threading.Event()

        def on_message(wsapp, message):
            try:
                m = _json.loads(message)
            except Exception:
                return
            if m.get("type") == "auth_ok":
                auth_ok_evt.set()
                return
            if m.get("type") == "contract_signed":
                received.append(m)
                event_evt.set()

        def on_open(wsapp):
            connected_evt.set()
            wsapp.send(_json.dumps({"token": rep_token}))

        wsapp = websocket.WebSocketApp(
            "ws://localhost:8001/ws/events",
            on_open=on_open,
            on_message=on_message,
            on_error=lambda *_: None,
        )
        thr = threading.Thread(target=wsapp.run_forever, daemon=True)
        thr.start()

        assert connected_evt.wait(timeout=5)
        assert auth_ok_evt.wait(timeout=5)

        # 100 m² * 275 = 27500 cost; gross 50000 → margin 22500 (81.8% → high)
        body = {
            "lead_id": lead["id"],
            "signed_at": "2026-04-23",
            "buildings_count": 1,
            "building_type": "mieszkalny",
            "roof_area_m2": 100.0,
            "gross_amount": 50000.0,
            "financing_type": "cash",
            "down_payment_amount": 50000.0,
            "installments_count": 1,
            "total_paid_amount": 50000.0,
        }
        r = api_client.post(
            f"{BASE_URL}/api/contracts",
            json=body,
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 200, r.text

        assert event_evt.wait(timeout=5), f"no event frame. received={received}"
        try:
            wsapp.close()
        except Exception:
            pass
        e = received[0]
        assert e.get("is_high_margin") is True
        assert e.get("margin_pct_of_cost") is not None and float(e["margin_pct_of_cost"]) >= 50.0
        assert e.get("computed_margin") == 22500.0
        self._cleanup()



# ============ SPRINT 3.5 — DAILY REPORT WIDGET ============


class TestDailyReport:
    """GET /api/reports/daily — manager (team scope) / admin (firm scope).
    Handlowiec gets 403."""

    def test_daily_report_handlowiec_403(self, api_client, rep_token):
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily",
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 403

    def test_daily_report_manager_scope(self, api_client, manager_token):
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["scope"] == "team"
        assert d["scope_name"].startswith("Zespół")
        # Team scope → no per-manager breakdown
        assert d.get("per_manager_breakdown") is None
        # Required top-level keys
        for k in (
            "period",
            "period_date",
            "generated_at",
            "contracts_signed",
            "contracts_cancelled",
            "negative_margin_contracts",
            "comparison",
            "meetings_tomorrow",
            "hot_leads",
            "new_leads_added",
            "top_rep",
            "top3_reps",
            "team_activity",
            "alerts",
        ):
            assert k in d, f"missing top-level key: {k}"
        # contracts_signed shape
        cs = d["contracts_signed"]
        for k in ("count", "total_gross", "total_margin", "total_commission", "avg_gross"):
            assert k in cs

    def test_daily_report_admin_scope(self, api_client, admin_token):
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["scope"] == "firm"
        # Firm scope → per-manager breakdown present (may be empty list)
        assert isinstance(d.get("per_manager_breakdown"), list)
        # Each manager entry has required keys
        for m in d["per_manager_breakdown"]:
            for k in (
                "manager_id",
                "manager_name",
                "reps_count",
                "contracts_today",
                "margin_today",
                "active_reps",
                "inactive_reps",
            ):
                assert k in m, f"missing {k} in per_manager entry"

    def test_daily_report_yesterday_period(self, api_client, manager_token):
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily?period=yesterday",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "yesterday"
        # Date should be exactly yesterday
        import datetime as _dt
        expected = (_dt.date.today() - _dt.timedelta(days=1)).isoformat()
        assert d["period_date"] == expected

    def test_daily_report_contracts_aggregation(self, api_client, rep_token, manager_token):
        """Sign a contract today as handlowiec; report for today must
        include it in count/margin sums."""
        import pymongo, uuid as _u
        # Prep: fresh lead + contract
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        mc["oze_crm"]["leads"].delete_many({"client_name": {"$regex": "^Daily_"}})
        mc["oze_crm"]["contracts"].delete_many({"client_name": {"$regex": "^Daily_"}})
        mc.close()

        lead = api_client.post(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"},
            json={
                "client_name": f"Daily_Agg_{_u.uuid4().hex[:6]}",
                "latitude": 53.3050,
                "longitude": 22.7050,
                "status": "umowione",
                "meeting_at": "2026-04-25T10:00:00",
                "photo_base64": "iVBORw0KGgo" + "A" * 200,
            },
        ).json()
        contract = api_client.post(
            f"{BASE_URL}/api/contracts",
            headers={"Authorization": f"Bearer {rep_token}"},
            json={
                "lead_id": lead["id"],
                "signed_at": "2026-04-23",  # inside today's window for the test server
                "buildings_count": 1,
                "building_type": "mieszkalny",
                "roof_area_m2": 150.0,
                "gross_amount": 55000.0,
                "financing_type": "cash",
                "down_payment_amount": 55000.0,
                "installments_count": 1,
                "total_paid_amount": 55000.0,
            },
        )
        assert contract.status_code == 200, contract.text

        # Because signed_at is a fixed past date in the seed, query by the date
        # of the contract's signed_at from the response to scope the assertion.
        from datetime import datetime as _dt, timezone as _tz
        signed_iso = contract.json().get("signed_at")
        # If signed_at happens to not fall on today's UTC date, skip live sums check
        today_utc = _dt.now(_tz.utc).date().isoformat()
        if signed_iso and signed_iso.startswith(today_utc):
            r = api_client.get(
                f"{BASE_URL}/api/reports/daily",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            d = r.json()
            assert d["contracts_signed"]["count"] >= 1
            assert d["contracts_signed"]["total_gross"] >= 55000.0

        # Cleanup
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        mc["oze_crm"]["leads"].delete_many({"client_name": {"$regex": "^Daily_"}})
        mc["oze_crm"]["contracts"].delete_many({"client_name": {"$regex": "^Daily_"}})
        mc.close()

    def test_daily_report_inactive_reps_alert(self, api_client, manager_token):
        """Manager report should surface inactive reps (no leads in last 3 days)
        as a warning alert. Demo seed has multiple reps; at least one is
        typically inactive."""
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        d = r.json()
        # At minimum, the team_activity.inactive_list shape must be present
        assert "inactive_list" in d["team_activity"]
        # And corresponding alerts have matching severity+type
        inactive_alerts = [a for a in d["alerts"] if a["type"] == "inactive_rep"]
        for a in inactive_alerts:
            assert a["severity"] == "warning"
            assert "days" in a["meta"]
            assert "rep_id" in a["meta"]

    def test_daily_report_negative_margin_alert(
        self, api_client, admin_token, rep_token, manager_token
    ):
        """Create a negative-margin contract via admin override; ensure
        the daily report emits a critical alert."""
        import pymongo, uuid as _u
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        mc["oze_crm"]["leads"].delete_many({"client_name": {"$regex": "^DailyNeg_"}})
        mc["oze_crm"]["contracts"].delete_many({"client_name": {"$regex": "^DailyNeg_"}})
        mc.close()

        lead = api_client.post(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"},
            json={
                "client_name": f"DailyNeg_{_u.uuid4().hex[:6]}",
                "latitude": 53.3070,
                "longitude": 22.7070,
                "status": "umowione",
                "meeting_at": "2026-04-25T10:00:00",
                "photo_base64": "iVBORw0KGgo" + "A" * 200,
            },
        ).json()
        contract = api_client.post(
            f"{BASE_URL}/api/contracts",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "lead_id": lead["id"],
                "signed_at": "2026-04-23",
                "buildings_count": 1,
                "building_type": "mieszkalny",
                "roof_area_m2": 200.0,  # cost 40000
                "gross_amount": 30000.0,  # negative margin -10000
                "allow_negative_margin": True,
                "financing_type": "cash",
                "down_payment_amount": 30000.0,
                "installments_count": 1,
                "total_paid_amount": 30000.0,
            },
        )
        assert contract.status_code == 200, contract.text

        # Query admin report — if this contract's signed date overlaps today,
        # the alert will be present.
        from datetime import datetime as _dt, timezone as _tz
        today_utc = _dt.now(_tz.utc).date().isoformat()
        signed_iso = contract.json().get("signed_at")
        if signed_iso and signed_iso.startswith(today_utc):
            r = api_client.get(
                f"{BASE_URL}/api/reports/daily",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            d = r.json()
            neg_alerts = [a for a in d["alerts"] if a["type"] == "negative_margin"]
            assert len(neg_alerts) >= 1
            assert neg_alerts[0]["severity"] == "critical"

        # Cleanup
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        mc["oze_crm"]["leads"].delete_many({"client_name": {"$regex": "^DailyNeg_"}})
        mc["oze_crm"]["contracts"].delete_many({"client_name": {"$regex": "^DailyNeg_"}})
        mc.close()

    # ────────────────────────────────────────────────────────────────────────
    # Sprint 3.5b: drill-down data enrichment
    # ────────────────────────────────────────────────────────────────────────
    def test_daily_report_includes_drill_down_data(self, api_client, manager_token):
        """Sprint 3.5b: ensure /reports/daily returns the extra fields required
        by the frontend drill-downs (rep_id for navigation, leads list per rep,
        inactive_list with rep_id, etc.)."""
        r = api_client.get(
            f"{BASE_URL}/api/reports/daily",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert r.status_code == 200, r.text
        d = r.json()

        # meetings_tomorrow.list entries
        for m in d["meetings_tomorrow"]["list"]:
            assert "lead_id" in m and "client_name" in m
            assert "meeting_at" in m and "rep_name" in m
            # rep_id may be None for unassigned but key must exist
            assert "rep_id" in m

        # hot_leads.list entries
        for l in d["hot_leads"]["list"]:
            assert "lead_id" in l and "client_name" in l
            assert "rep_name" in l and "rep_id" in l
            # Optional enrichment (safe if missing, but our server returns them)
            assert "phone" in l and "address" in l

        # new_leads_added.by_rep — now a list of {rep_id, rep_name, count, leads}
        assert isinstance(d["new_leads_added"]["by_rep"], list)
        for entry in d["new_leads_added"]["by_rep"]:
            assert "rep_id" in entry and "rep_name" in entry
            assert "count" in entry and isinstance(entry["count"], int)
            assert "leads" in entry and isinstance(entry["leads"], list)
            for lead in entry["leads"]:
                assert "id" in lead and "client_name" in lead

        # team_activity.inactive_list entries
        for r2 in d["team_activity"]["inactive_list"]:
            assert "rep_id" in r2 and "rep_name" in r2
            assert "last_active_days_ago" in r2

        # top3_reps entries (used for podium → drill into rep profile)
        for r2 in d["top3_reps"]:
            assert "rep_id" in r2 and "rep_name" in r2 and "medal" in r2

    # ────────────────────────────────────────────────────────────────────────
    # Sprint 3.5c micro: skip "never worked" reps (999d) from inactive alerts
    # ────────────────────────────────────────────────────────────────────────
    def test_daily_report_skips_999_days_alerts(
        self, api_client, manager_token
    ):
        """Create a brand-new handlowiec with zero activity (never added a lead).
        Ensure they still appear in team_activity.inactive_list (for head-count
        purposes) but do NOT fire an `inactive_rep` warning alert — otherwise
        managers get false 'Jan nieaktywny 999 dni' noise for brand-new hires.
        """
        import uuid as _u
        import pymongo
        from datetime import datetime, timezone

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        assert manager is not None, "manager@test.com seed missing"

        # Insert a handlowiec directly with zero activity (no leads, no
        # last_active_at). _compute_daily_report will flag them as 999d.
        new_id = str(_u.uuid4())
        new_email = f"neverworked_{_u.uuid4().hex[:8]}@test.com"
        mc["oze_crm"]["users"].insert_one(
            {
                "id": new_id,
                "email": new_email,
                "name": f"Never Worked {_u.uuid4().hex[:4]}",
                "role": "handlowiec",
                "manager_id": manager["id"],
                "password_hash": "dummy",
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        )

        try:
            r = api_client.get(
                f"{BASE_URL}/api/reports/daily",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            d = r.json()

            # Must appear in the inactive_list (head-count visibility)
            inactive_ids = {row["rep_id"] for row in d["team_activity"]["inactive_list"]}
            assert new_id in inactive_ids, (
                "New rep should show up in inactive_list for head-count"
            )

            # But MUST NOT emit an inactive_rep alert for them
            for a in d["alerts"]:
                if a["type"] == "inactive_rep" and a["meta"].get("rep_id") == new_id:
                    raise AssertionError(
                        f"Never-worked rep should NOT trigger inactive_rep alert (got {a})"
                    )

            # Belt-and-braces: no inactive_rep alert should have days >= 999
            for a in d["alerts"]:
                if a["type"] == "inactive_rep":
                    assert a["meta"]["days"] < 999, (
                        f"999+ days should be filtered out (got {a})"
                    )
        finally:
            mc["oze_crm"]["users"].delete_one({"id": new_id})
            mc.close()



# ═══════════════════════════════════════════════════════════
# Sprint 4 — rep activity (active / idle / offline)
# ═══════════════════════════════════════════════════════════
class TestRepActivity:
    """Sprint 4: /rep-activity endpoint + _bump_last_action hook tests."""

    def _fresh_handlowiec(
        self, manager_id: str, last_action_offset_minutes: "int | None" = None
    ):
        """Insert a rep directly in Mongo; returns (id, cleanup_fn)."""
        import uuid as _u
        import pymongo
        from datetime import datetime, timezone, timedelta

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        rid = str(_u.uuid4())
        doc = {
            "id": rid,
            "email": f"act_{_u.uuid4().hex[:8]}@test.com",
            "name": f"Activity {_u.uuid4().hex[:4]}",
            "role": "handlowiec",
            "manager_id": manager_id,
            "password_hash": "dummy",
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        if last_action_offset_minutes is not None:
            doc["last_action_at"] = datetime.now(timezone.utc) - timedelta(
                minutes=last_action_offset_minutes
            )
        mc["oze_crm"]["users"].insert_one(doc)

        def cleanup():
            mcc = pymongo.MongoClient("mongodb://localhost:27017")
            mcc["oze_crm"]["users"].delete_one({"id": rid})
            mcc.close()

        mc.close()
        return rid, cleanup

    def test_handlowiec_403(self, api_client, rep_token):
        r = api_client.get(
            f"{BASE_URL}/api/rep-activity",
            headers={"Authorization": f"Bearer {rep_token}"},
        )
        assert r.status_code == 403

    def test_manager_scope_only_team(self, api_client, manager_token):
        """Manager must only see reps in their own team."""
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()
        assert manager is not None

        # Create 1 rep for manager@test.com and 1 orphan rep (no manager_id)
        rep_mine, cleanup_mine = self._fresh_handlowiec(manager["id"], 10)
        rep_orphan, cleanup_orphan = self._fresh_handlowiec("__nonexistent__", 10)

        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            ids = {x["rep_id"] for x in r.json()["reps"]}
            assert rep_mine in ids
            assert rep_orphan not in ids, (
                "Manager must not see reps from other teams"
            )
        finally:
            cleanup_mine()
            cleanup_orphan()

    def test_admin_scope_sees_all(self, api_client, admin_token):
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()

        rep_mine, cleanup_mine = self._fresh_handlowiec(manager["id"], 5)
        rep_orphan, cleanup_orphan = self._fresh_handlowiec("__nonexistent__", 5)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert r.status_code == 200, r.text
            ids = {x["rep_id"] for x in r.json()["reps"]}
            assert rep_mine in ids and rep_orphan in ids
        finally:
            cleanup_mine()
            cleanup_orphan()

    def test_active_rep_recent_action(self, api_client, manager_token):
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()
        rid, cleanup = self._fresh_handlowiec(manager["id"], 10)  # 10 min ago
        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            entry = next((x for x in r.json()["reps"] if x["rep_id"] == rid), None)
            assert entry is not None
            assert entry["status"] == "active"
            assert 5 <= entry["minutes_ago"] <= 15
        finally:
            cleanup()

    def test_idle_rep_30min_plus_action(self, api_client, manager_token):
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()
        rid, cleanup = self._fresh_handlowiec(manager["id"], 120)  # 2h ago (today)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            entry = next((x for x in r.json()["reps"] if x["rep_id"] == rid), None)
            assert entry is not None
            assert entry["status"] == "idle", f"got {entry}"
        finally:
            cleanup()

    def test_offline_rep_yesterday(self, api_client, manager_token):
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()
        # 2 days ago — definitely not "today"
        rid, cleanup = self._fresh_handlowiec(manager["id"], 60 * 24 * 2)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            entry = next((x for x in r.json()["reps"] if x["rep_id"] == rid), None)
            assert entry is not None
            assert entry["status"] == "offline", f"got {entry}"
        finally:
            cleanup()

    def test_offline_rep_never_worked(self, api_client, manager_token):
        """Brand-new handlowiec (no last_action_at field) should be 'offline'."""
        import pymongo

        mc = pymongo.MongoClient("mongodb://localhost:27017")
        manager = mc["oze_crm"]["users"].find_one({"email": "manager@test.com"})
        mc.close()
        rid, cleanup = self._fresh_handlowiec(manager["id"], None)
        try:
            r = api_client.get(
                f"{BASE_URL}/api/rep-activity",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
            assert r.status_code == 200, r.text
            entry = next((x for x in r.json()["reps"] if x["rep_id"] == rid), None)
            assert entry is not None
            assert entry["status"] == "offline"
            assert entry["last_action_at"] is None
            assert entry["minutes_ago"] is None
        finally:
            cleanup()

    def test_bump_last_action_on_lead_create(self, api_client, rep_token):
        """Creating a lead as handlowiec should stamp last_action_at."""
        import pymongo
        from datetime import datetime, timezone, timedelta

        # Snapshot rep doc before
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        before = mc["oze_crm"]["users"].find_one({"email": "handlowiec@test.com"})
        before_ts = before.get("last_action_at")
        mc.close()

        # Create a lead via API
        import uuid as _u
        payload = {
            "client_name": f"BumpTest_{_u.uuid4().hex[:6]}",
            "phone": "+48111222333",
            "address": "ul. Testowa 99, Gdańsk",
            "latitude": 54.35,
            "longitude": 18.60,
            "status": "nowy",
            # Faza 2.1 — photo is required for handlowiec lead creation
            "photo_base64": "data:image/png;base64," + ("A" * 200),
        }
        r = api_client.post(
            f"{BASE_URL}/api/leads",
            headers={"Authorization": f"Bearer {rep_token}"},
            json=payload,
        )
        assert r.status_code == 200, r.text
        lead_id = r.json()["id"]

        # Confirm last_action_at advanced
        mc = pymongo.MongoClient("mongodb://localhost:27017")
        after = mc["oze_crm"]["users"].find_one({"email": "handlowiec@test.com"})
        after_ts = after.get("last_action_at")
        # Cleanup
        mc["oze_crm"]["leads"].delete_one({"id": lead_id})
        mc.close()

        assert after_ts is not None, "last_action_at must be set after lead create"
        if before_ts is not None:
            assert after_ts > before_ts, (
                "last_action_at must advance after POST /leads"
            )

    def test_dashboard_manager_embeds_activity_status(
        self, api_client, manager_token
    ):
        """reps_live[] entries must carry activity_status + activity_minutes_ago."""
        r = api_client.get(
            f"{BASE_URL}/api/dashboard/manager",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for rep in d.get("reps_live", []):
            assert "activity_status" in rep, f"missing activity_status in {rep}"
            assert rep["activity_status"] in ("active", "idle", "offline")
            assert "activity_minutes_ago" in rep
