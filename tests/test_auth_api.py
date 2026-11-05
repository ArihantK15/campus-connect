import base64
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import app as service


AUTH_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
APP_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


class AuthenticatedAPITests(unittest.TestCase):
    def setUp(self):
        self.auth_user = SimpleNamespace(
            id=AUTH_USER_ID,
            email="attendee@example.com",
            email_confirmed_at="2026-11-04T12:00:00Z",
            user_metadata={"display_name": "Campus Attendee"},
        )
        self.public_client = Mock()
        self.public_client.auth.get_user.return_value = SimpleNamespace(user=self.auth_user)
        self.service_client = Mock()
        self.client_patches = (
            patch.object(service, "supabase_public", self.public_client),
            patch.object(service, "supabase", self.service_client),
        )
        for patcher in self.client_patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = service.app.test_client()
        self.app_user = {
            "id": APP_USER_ID,
            "email": "attendee@example.com",
            "role": "attendee",
            "auth_user_id": AUTH_USER_ID,
        }

    def test_protected_route_rejects_missing_bearer_token(self):
        response = self.client.get("/api/me")

        self.assertEqual(response.status_code, 401)
        self.public_client.auth.get_user.assert_not_called()

    def test_protected_route_rejects_invalid_auth_user(self):
        self.public_client.auth.get_user.return_value = SimpleNamespace(user=None)

        response = self.client.get("/api/me", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 401)

    def test_protected_route_rejects_unconfirmed_email(self):
        self.auth_user.email_confirmed_at = None

        with patch.object(service, "get_one") as get_one:
            response = self.client.get("/api/me", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 403)
        get_one.assert_not_called()

    def test_protected_route_rejects_unlinked_user(self):
        with patch.object(service, "get_one", return_value=None):
            response = self.client.get("/api/me", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 403)

    def test_profile_uses_verified_identity_and_database_role(self):
        organizer = {**self.app_user, "role": "organizer"}
        with patch.object(service, "get_one", return_value=organizer):
            response = self.client.get("/api/me", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["id"], AUTH_USER_ID)
        self.assertEqual(response.json["email"], "attendee@example.com")
        self.assertEqual(response.json["name"], "Campus Attendee")
        self.assertEqual(response.json["role"], "organizer")

    def test_registration_uses_mapped_app_user_id(self):
        registration = {"id": "registration-id", "event_id": EVENT_ID, "user_id": APP_USER_ID}
        self.service_client.rpc.return_value.execute.return_value = SimpleNamespace(
            data={"status": "created", "registration": registration}
        )
        with patch.object(service, "get_one", side_effect=[self.app_user, {"id": EVENT_ID, "capacity": 10}]):
            response = self.client.post(
                "/api/registrations",
                json={"event_id": EVENT_ID},
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 201)
        self.service_client.rpc.assert_called_once_with(
            "register_for_event",
            {"p_event_id": EVENT_ID, "p_user_id": APP_USER_ID},
        )

    def test_organizer_cannot_register_as_attendee(self):
        organizer = {**self.app_user, "role": "organizer"}
        with patch.object(service, "get_one", return_value=organizer):
            response = self.client.post(
                "/api/registrations",
                json={"event_id": EVENT_ID},
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 403)
        self.service_client.rpc.assert_not_called()

    def test_attendee_cannot_view_organizer_registration_list(self):
        with patch.object(service, "get_one", return_value=self.app_user):
            response = self.client.get(
                f"/api/events/{EVENT_ID}/registrations",
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 403)
        self.service_client.table.assert_not_called()

    def test_public_config_never_exposes_a_service_role_key(self):
        encoded_claims = base64.urlsafe_b64encode(
            json.dumps({"role": "service_role"}).encode()
        ).decode().rstrip("=")
        service_role_key = f"header.{encoded_claims}.signature"
        with (
            patch.object(service, "SUPABASE_URL", "https://example.supabase.co"),
            patch.object(service, "SUPABASE_PUBLISHABLE_KEY", service_role_key),
            patch.object(service, "SUPABASE_SERVICE_ROLE_KEY", service_role_key),
        ):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 503)
        self.assertNotIn(service_role_key, response.get_data(as_text=True))

    def test_admin_route_uses_shared_auth_and_checks_database_role(self):
        with patch.object(service, "get_one", return_value=self.app_user):
            response = self.client.get("/api/admin/users", headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 403)
        self.public_client.auth.get_user.assert_called_once_with("token")
        self.service_client.table.assert_not_called()

    def test_admin_pagination_rejects_bad_and_non_positive_values(self):
        admin = {**self.app_user, "role": "admin"}
        with patch.object(service, "get_one", return_value=admin):
            for query in ("page=nope", "page=0", "per_page=-1"):
                with self.subTest(query=query):
                    response = self.client.get(f"/api/admin/users?{query}", headers={"Authorization": "Bearer token"})
                    self.assertEqual(response.status_code, 400)

    def test_event_validation_rejects_naive_timestamps_and_unknown_fields(self):
        self.auth_user.user_metadata["role"] = "organizer"
        organizer = {**self.app_user, "role": "organizer"}
        for payload in (
            {"title": "Meetup", "timestamp": "2026-11-05T12:00:00"},
            {"title": "Meetup", "organizer_id": APP_USER_ID},
        ):
            with self.subTest(payload=payload), patch.object(service, "get_one", return_value=organizer):
                response = self.client.post("/api/events", json=payload, headers={"Authorization": "Bearer token"})
                self.assertEqual(response.status_code, 400)
        self.service_client.table.assert_not_called()

    def test_event_image_accepts_local_assets_but_rejects_script_urls(self):
        with service.app.test_request_context():
            fields, error, status = service.validate_event_fields(
                {"title": "Meetup", "image_url": "assets/event-1.jpg"}
            )
            self.assertIsNone(error)
            self.assertIsNone(status)
            self.assertEqual(fields["image_url"], "assets/event-1.jpg")

            _fields, error, status = service.validate_event_fields(
                {"title": "Meetup", "image_url": "javascript:alert(1)"}
            )
            self.assertEqual(status, 400)
            self.assertEqual(error.get_json()["error"], "image_url must use HTTP or HTTPS.")

    def test_admin_cannot_remove_own_role(self):
        admin = {**self.app_user, "role": "admin"}
        with patch.object(service, "get_one", return_value=admin):
            response = self.client.patch(
                f"/api/admin/users/{APP_USER_ID}",
                json={"role": "attendee"},
                headers={"Authorization": "Bearer token"},
            )
        self.assertEqual(response.status_code, 400)

    def test_admin_user_delete_preserves_data_when_user_owns_events(self):
        admin = {**self.app_user, "role": "admin"}
        target = {"id": EVENT_ID, "role": "organizer"}
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.execute.return_value = SimpleNamespace(count=2, data=[])
        with (
            patch.object(service, "get_one", side_effect=[admin, target]),
            patch.object(self.service_client, "table", return_value=query),
        ):
            response = self.client.delete(
                f"/api/admin/users/{EVENT_ID}", headers={"Authorization": "Bearer token"}
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("still owns events", response.json["error"])

    def test_organizer_dashboard_counts_each_event_registrations(self):
        organizer = {**self.app_user, "role": "organizer"}
        rows = [{"id": EVENT_ID, "organiser_id": APP_USER_ID, "title": "Meetup", "capacity": 0}]
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.order.return_value = query
        query.execute.return_value = SimpleNamespace(data=rows)
        with (
            patch.object(service, "get_one", return_value=organizer),
            patch.object(self.service_client, "table", return_value=query),
        ):
            response = self.client.get(
                "/api/me/events", headers={"Authorization": "Bearer token"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json[0]["organiser_email"], organizer["email"])

    def test_public_organizer_filter_does_not_fetch_or_expose_email(self):
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.order.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"id": EVENT_ID, "title": "Meetup"}])
        with (
            patch.object(service.supabase_public, "table", return_value=query, create=True),
            patch.object(service, "get_one") as get_one,
        ):
            response = self.client.get(f"/api/events?organiser_id={APP_USER_ID}")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("organiser_email", response.json[0])
        get_one.assert_not_called()

    def test_current_user_events_rejects_attendees(self):
        with patch.object(service, "get_one", return_value=self.app_user):
            response = self.client.get("/api/me/events", headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 403)

    def test_organizer_can_fetch_exact_registration_count(self):
        organizer = {**self.app_user, "role": "organizer"}
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.execute.return_value = SimpleNamespace(count=7, data=[])
        with (
            patch.object(service, "get_one", side_effect=[organizer, {"id": EVENT_ID, "organiser_id": APP_USER_ID}]),
            patch.object(self.service_client, "table", return_value=query),
        ):
            response = self.client.get(
                f"/api/events/{EVENT_ID}/registrations?count_only=true",
                headers={"Authorization": "Bearer token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"count": 7})


if __name__ == "__main__":
    unittest.main()
