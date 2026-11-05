"""API behaviour tests for the self-contained Campus Connect backend (no sign-in)."""
import os
import tempfile
import unittest
from pathlib import Path

TMP_DIR = tempfile.TemporaryDirectory()
os.environ["DATABASE_PATH"] = str(Path(TMP_DIR.name) / "test.db")

import app as campus  # noqa: E402  (imported after DATABASE_PATH is set)


def user_id(client, name):
    users = client.get("/api/users").get_json()
    return next(user["id"] for user in users if user["name"] == name)


class CampusApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = campus.app.test_client()
        cls.maya = user_id(cls.client, "Maya Chen")
        cls.sam = user_id(cls.client, "Sam Rivera")
        cls.avery = user_id(cls.client, "Avery Patel")
        cls.taylor = user_id(cls.client, "Taylor Brooks")
        cls.morgan = user_id(cls.client, "Morgan Ellis")

    def headers(self, user):
        return {"X-User-Id": user}

    def test_seeded_events_are_public_and_match_the_workshop_data(self):
        events = self.client.get("/api/events").get_json()
        self.assertGreaterEqual(len(events), 4)
        self.assertIn("organiser_name", events[0])
        self.assertIn("Product Builders Meetup", [event["title"] for event in events])

    def test_writes_need_a_chosen_user_with_the_right_role(self):
        payload = {"title": "Nope"}
        self.assertEqual(self.client.post("/api/events", json=payload).status_code, 401)
        self.assertEqual(self.client.post("/api/events", json=payload, headers=self.headers(self.avery)).status_code, 403)

    def test_organizer_creates_edits_and_deletes_own_event(self):
        created = self.client.post(
            "/api/events",
            json={"title": "Robotics Night", "timestamp": "2026-12-01T19:00", "capacity": 2, "price": 0},
            headers=self.headers(self.maya),
        )
        self.assertEqual(created.status_code, 201)
        event = created.get_json()
        self.assertEqual(event["timestamp"], "2026-12-01T13:30:00Z")  # naive input is campus-local (IST)

        self.assertEqual(
            self.client.patch(f"/api/events/{event['id']}", json={"title": "Hijack"}, headers=self.headers(self.sam)).status_code,
            403,
        )
        updated = self.client.patch(f"/api/events/{event['id']}", json={"title": "Robotics Night 2"}, headers=self.headers(self.maya))
        self.assertEqual(updated.get_json()["title"], "Robotics Night 2")
        self.assertEqual(self.client.delete(f"/api/events/{event['id']}", headers=self.headers(self.maya)).status_code, 200)

    def test_registration_rules_capacity_and_duplicates(self):
        event = self.client.post(
            "/api/events", json={"title": "Tiny Workshop", "timestamp": "2026-12-02T10:00", "capacity": 1},
            headers=self.headers(self.maya),
        ).get_json()
        self.assertEqual(self.client.post("/api/registrations", json={"event_id": event["id"]}, headers=self.headers(self.morgan)).status_code, 403)
        self.assertEqual(self.client.post("/api/registrations", json={"event_id": event["id"]}, headers=self.headers(self.avery)).status_code, 201)
        duplicate = self.client.post("/api/registrations", json={"event_id": event["id"]}, headers=self.headers(self.avery))
        self.assertEqual(duplicate.status_code, 409)
        full = self.client.post("/api/registrations", json={"event_id": event["id"]}, headers=self.headers(self.taylor))
        self.assertEqual(full.get_json()["error"], "This event is full.")
        self.assertEqual(self.client.delete(f"/api/registrations/{event['id']}", headers=self.headers(self.avery)).status_code, 200)

    def test_organizer_sees_attendees_for_own_event_only(self):
        event_id = self.client.get("/api/events").get_json()[0]["id"]
        attendees = self.client.get(f"/api/events/{event_id}/registrations", headers=self.headers(self.maya))
        self.assertEqual(attendees.status_code, 200)
        self.assertEqual(self.client.get(f"/api/events/{event_id}/registrations", headers=self.headers(self.sam)).status_code, 403)

    def test_saved_events_and_communities_are_per_user(self):
        event_id = self.client.get("/api/events").get_json()[1]["id"]
        self.assertEqual(self.client.put(f"/api/me/saved/{event_id}", headers=self.headers(self.taylor)).status_code, 200)
        self.assertIn(event_id, self.client.get("/api/me/saved", headers=self.headers(self.taylor)).get_json())
        self.client.delete(f"/api/me/saved/{event_id}", headers=self.headers(self.taylor))

        self.assertEqual(self.client.put("/api/me/communities/3", headers=self.headers(self.taylor)).status_code, 200)
        communities = self.client.get("/api/communities", headers=self.headers(self.taylor)).get_json()
        self.assertTrue(next(item for item in communities if item["id"] == 3)["joined"])
        self.client.delete("/api/me/communities/3", headers=self.headers(self.taylor))

    def test_admin_guards_and_role_changes(self):
        self.assertEqual(self.client.get("/api/admin/users", headers=self.headers(self.maya)).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/stats", headers=self.headers(self.morgan)).status_code, 200)
        self.assertEqual(
            self.client.patch(f"/api/admin/users/{self.morgan}", json={"role": "attendee"}, headers=self.headers(self.morgan)).status_code,
            400,
        )
        promoted = self.client.patch(f"/api/admin/users/{self.taylor}", json={"role": "organizer"}, headers=self.headers(self.morgan))
        self.assertEqual(promoted.get_json()["role"], "organizer")
        self.client.patch(f"/api/admin/users/{self.taylor}", json={"role": "attendee"}, headers=self.headers(self.morgan))

    def test_frontend_is_served_from_the_same_origin(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/api/unknown").get_json(), {"error": "Not found."})


if __name__ == "__main__":
    unittest.main()
