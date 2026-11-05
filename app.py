"""Campus Connect: a self-contained Flask API that also serves the frontend.

There is no sign-in. The browser picks a user from the top-right switcher and
sends that user's id in the ``X-User-Id`` header; role rules (attendee,
organizer, admin) are applied to the chosen user. Data lives in SQLite, so the
app needs no external services. Set ``DATABASE_PATH`` to choose where the
database file is stored.
"""

import math
import os
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from posixpath import normpath
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import Flask, current_app, g, jsonify, request, send_from_directory

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

FRONTEND_DIR = PROJECT_ROOT / "campus-connect"
ROLES = ("attendee", "organizer", "admin")
CAMPUS_TIME_ZONE = ZoneInfo(os.environ.get("CAMPUS_TIME_ZONE", "Asia/Kolkata"))
EVENT_SELECT = """
    SELECT e.id, e.organiser_id, u.name AS organiser_name, u.email AS organiser_email,
           e.title, e.capacity, e.timestamp, e.description, e.location, e.price,
           e.image_url, e.created_at
    FROM events e
    JOIN users u ON u.id = e.organiser_id
"""
EVENT_FIELDS = ("title", "capacity", "timestamp", "description", "location", "price", "image_url")
SEED_NAMESPACE = uuid.UUID("3c9f7d52-8a4e-4f1b-9d7c-2b6e1a0f5c11")


class ApiError(Exception):
    """An expected failure that maps to a JSON error response."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def error_response(message, status):
    return jsonify({"error": message}), status


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def connect(path):
    connection = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def transaction(connection):
    """Run a write block atomically; BEGIN IMMEDIATE serialises concurrent registrations."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    else:
        connection.execute("COMMIT")


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('attendee', 'organizer', 'admin')),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    organiser_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
    timestamp TEXT,
    description TEXT,
    location TEXT,
    price REAL CHECK (price IS NULL OR price >= 0),
    image_url TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_organiser_idx ON events(organiser_id);
CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS registrations_user_idx ON registrations(user_id);
CREATE TABLE IF NOT EXISTS saved_events (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_id)
);
CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    base_members INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS community_memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, community_id)
);
"""

SEED_USERS = [
    ("user-1", "Avery Patel", "avery@westbridge.edu", "attendee"),
    ("user-2", "Maya Chen", "maya@westbridge.edu", "organizer"),
    ("user-3", "Sam Rivera", "sam@westbridge.edu", "organizer"),
    ("user-4", "Taylor Brooks", "taylor@westbridge.edu", "attendee"),
    ("user-5", "Morgan Ellis", "morgan@westbridge.edu", "admin"),
]
SEED_EVENTS = [
    ("evt-1", "user-2", "Product Builders Meetup", 90, "2026-11-12T18:30:00+05:30",
     "Meet student founders, share what you are building, and find your next collaborator.",
     "Main Auditorium", 0, "assets/event-1.jpg"),
    ("evt-2", "user-2", "Campus Music Fest", 240, "2026-11-15T16:00:00+05:30",
     "An afternoon of live sets, food stalls, and campus artists.",
     "Main Quad", 5, "assets/event-2.jpg"),
    ("evt-3", "user-2", "Yoga & Mindfulness", 30, "2026-11-18T07:00:00+05:30",
     "A relaxed, all-levels session to start the day feeling grounded.",
     "Studio B", 0, "assets/event-3.jpg"),
    ("evt-4", "user-3", "Community Garden Day", 45, "2026-11-20T15:00:00+05:30",
     "Plant, learn, and spend an easy afternoon outside with campus neighbors.",
     "East Garden", 0, "assets/event-5.jpg"),
]
SEED_REGISTRATIONS = [("user-1", "evt-1"), ("user-1", "evt-4"), ("user-4", "evt-2")]
SEED_SAVED = [("user-1", "evt-2"), ("user-4", "evt-1")]
SEED_COMMUNITIES = [
    (1, "The Makers Society", "For curious hands and creative minds. Pottery, art, design, and everything in between.", "discover", 128),
    (2, "Campus Social Society", "Coffee dates, shared tables, and the friends you haven’t met yet.", "people", 342),
    (3, "Campus Wellbeing Collective", "A little more movement. A little more balance. Find your feel-good community.", "check", 216),
    (4, "Westbridge Developer Club", "Build things, share ideas, and meet your next project partner.", "calendar", 189),
]
SEED_MEMBERSHIPS = [("user-1", 1), ("user-1", 3), ("user-4", 2)]


def seed_database(connection):
    """Populate a new database with the workshop's sample campus. Runs once, when no users exist."""
    if connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        return
    stamp = now_iso()
    with transaction(connection):
        for key, name, email, role in SEED_USERS:
            connection.execute(
                "INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (str(uuid.uuid5(SEED_NAMESPACE, key)), name, email, role, stamp),
            )
        for key, organiser, title, capacity, timestamp, description, location, price, image in SEED_EVENTS:
            connection.execute(
                """INSERT INTO events (id, organiser_id, title, capacity, timestamp, description, location, price, image_url, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid5(SEED_NAMESPACE, key)),
                    str(uuid.uuid5(SEED_NAMESPACE, organiser)),
                    title,
                    capacity,
                    normalise_timestamp(timestamp),
                    description,
                    location,
                    price,
                    image,
                    stamp,
                ),
            )
        for community_id, name, description, icon, base in SEED_COMMUNITIES:
            connection.execute(
                "INSERT INTO communities (id, name, description, icon, base_members) VALUES (?, ?, ?, ?, ?)",
                (community_id, name, description, icon, base),
            )
        for user_key, event_key in SEED_REGISTRATIONS:
            connection.execute(
                "INSERT INTO registrations (id, event_id, user_id, created_at) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), seed_id(event_key), seed_id(user_key), stamp),
            )
        for user_key, event_key in SEED_SAVED:
            connection.execute(
                "INSERT INTO saved_events (user_id, event_id, created_at) VALUES (?, ?, ?)",
                (seed_id(user_key), seed_id(event_key), stamp),
            )
        for user_key, community_id in SEED_MEMBERSHIPS:
            connection.execute(
                "INSERT INTO community_memberships (user_id, community_id, created_at) VALUES (?, ?, ?)",
                (seed_id(user_key), community_id, stamp),
            )


def seed_id(key):
    return str(uuid.uuid5(SEED_NAMESPACE, key))


def normalise_timestamp(value):
    """Store timestamps as UTC. Naive values are campus-local, which is what the event form sends."""
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Timestamp must be an ISO 8601 string or null.")
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=CAMPUS_TIME_ZONE)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_past(timestamp):
    if not timestamp:
        return False
    return datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)


def validate_image_url(value):
    if not value:
        return value
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("image_url must use HTTP or HTTPS.")
        return value
    relative = normpath(value)
    if not relative.startswith("assets/") or "\\" in value or parsed.query or parsed.fragment:
        raise ValueError("image_url must be an HTTP(S) URL or a path under assets/.")
    return value


def parse_event(payload, *, partial=False):
    """Validate event fields. Returns (data, None) or (None, ApiError)."""
    if not isinstance(payload, dict):
        return None, ApiError("A JSON object is required.", 400)
    unknown = sorted(set(payload) - set(EVENT_FIELDS))
    if unknown:
        return None, ApiError(f"Unknown event field: {unknown[0]}.", 400)
    data = {}
    try:
        if not partial or "title" in payload:
            title = payload.get("title")
            if not isinstance(title, str) or not title.strip():
                raise ValueError("Title is required and cannot be empty.")
            if len(title.strip()) > 120:
                raise ValueError("Title must be 120 characters or fewer.")
            data["title"] = title.strip()
        if "capacity" in payload:
            value = payload["capacity"]
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError("Capacity must be a non-negative whole number or null.")
            data["capacity"] = value
        if "timestamp" in payload:
            data["timestamp"] = normalise_timestamp(payload["timestamp"])
        for field, limit in (("description", 2000), ("location", 200), ("image_url", 2048)):
            if field in payload:
                value = payload[field]
                if value is not None and not isinstance(value, str):
                    raise ValueError(f"{field} must be a string or null.")
                value = value.strip() if isinstance(value, str) else None
                if value and len(value) > limit:
                    raise ValueError(f"{field} must be {limit} characters or fewer.")
                data[field] = value or None
        if "image_url" in data:
            validate_image_url(data["image_url"])
        if "price" in payload:
            value = payload["price"]
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise ValueError("Price must be a non-negative number or null.")
            data["price"] = value
    except (ValueError, TypeError) as error:
        return None, ApiError(str(error), 400)
    return data, None


def parse_pagination():
    try:
        page = int(request.args.get("page", "1"))
        per_page = int(request.args.get("per_page", "20"))
    except ValueError:
        raise ApiError("page and per_page must be integers.", 400)
    if page < 1 or per_page < 1:
        raise ApiError("page and per_page must be positive.", 400)
    per_page = min(per_page, 100)
    return page, per_page, (page - 1) * per_page


def db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE_PATH"])
    return g.db


def query_one(sql, params=()):
    row = db().execute(sql, params).fetchone()
    return dict(row) if row else None


def query_all(sql, params=()):
    return [dict(row) for row in db().execute(sql, params).fetchall()]


def fetch_event(event_id):
    return query_one(EVENT_SELECT + " WHERE e.id = ?", (event_id,))


def current_user_or_none():
    user_id = request.headers.get("X-User-Id", "").strip()
    if not is_uuid(user_id):
        return None
    return query_one("SELECT id, name, email, role FROM users WHERE id = ?", (user_id,))


def require_user(*roles):
    """Require a chosen user. With roles, the user's role must be one of them."""
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            user = current_user_or_none()
            if user is None:
                return error_response("Choose a user to continue.", 401)
            if roles and user["role"] not in roles:
                return error_response(f"This action is limited to {' or '.join(roles)} users.", 403)
            g.user = user
            return view(*args, **kwargs)
        return wrapper
    return decorator


def registration_count(event_id):
    return db().execute("SELECT COUNT(*) FROM registrations WHERE event_id = ?", (event_id,)).fetchone()[0]


def require_event_owner_or_admin(event_id):
    event = query_one("SELECT id, organiser_id FROM events WHERE id = ?", (event_id,))
    if event is None:
        raise ApiError("Event not found.", 404)
    if g.user["role"] != "admin" and event["organiser_id"] != g.user["id"]:
        raise ApiError("Only the event organizer or an admin can do this.", 403)
    return event


def create_app(database_path=None):
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
    path = Path(database_path or os.environ.get("DATABASE_PATH") or PROJECT_ROOT / "data" / "campus_connect.db")
    path.parent.mkdir(parents=True, exist_ok=True)
    app.config["DATABASE_PATH"] = str(path)
    with closing(connect(path)) as connection:
        connection.executescript(SCHEMA)
        seed_database(connection)

    @app.teardown_appcontext
    def close_db(_exception):
        connection = g.pop("db", None)
        if connection is not None:
            connection.close()

    @app.errorhandler(ApiError)
    def handle_api_error(error):
        return error_response(error.message, error.status)

    @app.errorhandler(404)
    def not_found(_error):
        return error_response("Not found.", 404)

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return error_response("Method not allowed.", 405)

    @app.errorhandler(sqlite3.Error)
    def database_error(error):
        app.logger.exception("Database error: %s", error)
        return error_response("Database request failed.", 500)

    # --- Health and identity -------------------------------------------------

    @app.get("/healthz")
    def healthcheck():
        db().execute("SELECT 1").fetchone()
        return jsonify({"status": "ok"})

    @app.get("/api/users")
    def list_users():
        """Everyone who can be chosen in the user switcher."""
        return jsonify(query_all(
            """SELECT id, name, email, role FROM users
               ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'organizer' THEN 1 ELSE 2 END, name"""
        ))

    @app.get("/api/me")
    @require_user()
    def current_user():
        return jsonify(g.user)

    # --- Events --------------------------------------------------------------

    @app.get("/api/events")
    def list_events():
        organiser_id = request.args.get("organiser_id")
        if organiser_id:
            if not is_uuid(organiser_id):
                return error_response("Invalid organiser_id.", 400)
            rows = query_all(EVENT_SELECT + " WHERE e.organiser_id = ? ORDER BY e.timestamp", (organiser_id,))
        else:
            rows = query_all(EVENT_SELECT + " ORDER BY e.timestamp")
        return jsonify(rows)

    @app.get("/api/events/<event_id>")
    def get_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        event = fetch_event(event_id)
        if event is None:
            return error_response("Event not found.", 404)
        return jsonify(event)

    @app.post("/api/events")
    @require_user("organizer", "admin")
    def create_event():
        data, problem = parse_event(request.get_json(silent=True))
        if problem:
            raise problem
        if "title" not in data:
            raise ApiError("Title is required and cannot be empty.", 400)
        event_id = str(uuid.uuid4())
        values = {
            "id": event_id,
            "organiser_id": g.user["id"],
            "capacity": None,
            "timestamp": None,
            "description": None,
            "location": None,
            "price": 0,
            "image_url": None,
            "created_at": now_iso(),
            **data,
        }
        columns = ", ".join(values)
        placeholders = ", ".join("?" for _ in values)
        db().execute(f"INSERT INTO events ({columns}) VALUES ({placeholders})", tuple(values.values()))
        return jsonify(fetch_event(event_id)), 201

    @app.patch("/api/events/<event_id>")
    @require_user("organizer", "admin")
    def update_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        data, problem = parse_event(request.get_json(silent=True), partial=True)
        if problem:
            raise problem
        if not data:
            return error_response("At least one event field is required.", 400)
        require_event_owner_or_admin(event_id)
        assignments = ", ".join(f"{column} = ?" for column in data)
        db().execute(f"UPDATE events SET {assignments} WHERE id = ?", (*data.values(), event_id))
        return jsonify(fetch_event(event_id))

    @app.delete("/api/events/<event_id>")
    @require_user("organizer", "admin")
    def delete_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        require_event_owner_or_admin(event_id)
        db().execute("DELETE FROM events WHERE id = ?", (event_id,))
        return jsonify({"status": "deleted", "event_id": event_id})

    @app.get("/api/me/events")
    @require_user("organizer", "admin")
    def my_events():
        return jsonify(query_all(EVENT_SELECT + " WHERE e.organiser_id = ? ORDER BY e.timestamp", (g.user["id"],)))

    @app.get("/api/events/<event_id>/registrations")
    @require_user("organizer", "admin")
    def event_registrations(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        require_event_owner_or_admin(event_id)
        if request.args.get("count_only", "").lower() == "true":
            count = db().execute("SELECT COUNT(*) FROM registrations WHERE event_id = ?", (event_id,)).fetchone()[0]
            return jsonify({"count": count})
        return jsonify(query_all(
            """SELECT r.id, r.event_id, r.user_id, r.created_at, u.name AS user_name, u.email AS user_email
               FROM registrations r JOIN users u ON u.id = r.user_id
               WHERE r.event_id = ? ORDER BY r.created_at""",
            (event_id,),
        ))

    # --- Registrations and saved events ---------------------------------------

    @app.post("/api/registrations")
    @require_user("attendee")
    def register_for_event():
        payload = request.get_json(silent=True)
        event_id = payload.get("event_id") if isinstance(payload, dict) else None
        if not is_uuid(event_id):
            return error_response("A valid event_id is required.", 400)
        with transaction(db()):
            event = query_one("SELECT id, capacity, timestamp FROM events WHERE id = ?", (event_id,))
            if event is None:
                raise ApiError("Event not found.", 404)
            if is_past(event["timestamp"]):
                raise ApiError("This event has already taken place.", 409)
            already = query_one(
                "SELECT id FROM registrations WHERE event_id = ? AND user_id = ?",
                (event_id, g.user["id"]),
            )
            if already:
                raise ApiError("You are already registered for this event.", 409)
            if event["capacity"] is not None:
                taken = db().execute("SELECT COUNT(*) FROM registrations WHERE event_id = ?", (event_id,)).fetchone()[0]
                if taken >= event["capacity"]:
                    raise ApiError("This event is full.", 409)
            registration = {
                "id": str(uuid.uuid4()),
                "event_id": event_id,
                "user_id": g.user["id"],
                "created_at": now_iso(),
            }
            db().execute(
                "INSERT INTO registrations (id, event_id, user_id, created_at) VALUES (:id, :event_id, :user_id, :created_at)",
                registration,
            )
        return jsonify(registration), 201

    @app.delete("/api/registrations/<event_id>")
    @require_user("attendee")
    def cancel_registration(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        removed = db().execute(
            "DELETE FROM registrations WHERE event_id = ? AND user_id = ?",
            (event_id, g.user["id"]),
        ).rowcount
        if not removed:
            return error_response("Registration not found.", 404)
        return jsonify({"event_id": event_id, "status": "cancelled"})

    @app.get("/api/me/registrations")
    @require_user()
    def my_registrations():
        return jsonify(query_all(
            "SELECT id, event_id, user_id, created_at FROM registrations WHERE user_id = ? ORDER BY created_at DESC",
            (g.user["id"],),
        ))

    @app.get("/api/me/saved")
    @require_user()
    def my_saved_events():
        rows = query_all("SELECT event_id FROM saved_events WHERE user_id = ? ORDER BY created_at", (g.user["id"],))
        return jsonify([row["event_id"] for row in rows])

    @app.put("/api/me/saved/<event_id>")
    @require_user()
    def save_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        if fetch_event(event_id) is None:
            return error_response("Event not found.", 404)
        db().execute(
            "INSERT OR IGNORE INTO saved_events (user_id, event_id, created_at) VALUES (?, ?, ?)",
            (g.user["id"], event_id, now_iso()),
        )
        return jsonify({"event_id": event_id, "saved": True})

    @app.delete("/api/me/saved/<event_id>")
    @require_user()
    def unsave_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        db().execute("DELETE FROM saved_events WHERE user_id = ? AND event_id = ?", (g.user["id"], event_id))
        return jsonify({"event_id": event_id, "saved": False})

    # --- Communities ----------------------------------------------------------

    @app.get("/api/communities")
    def list_communities():
        current = current_user_or_none()
        joined = set()
        if current:
            joined = {row["community_id"] for row in query_all(
                "SELECT community_id FROM community_memberships WHERE user_id = ?", (current["id"],))}
        communities = query_all(
            """SELECT c.id, c.name, c.description, c.icon, c.base_members,
                      (SELECT COUNT(*) FROM community_memberships m WHERE m.community_id = c.id) AS joined_members
               FROM communities c ORDER BY c.id"""
        )
        for community in communities:
            community["member_count"] = community.pop("base_members") + community.pop("joined_members")
            community["joined"] = community["id"] in joined
        return jsonify(communities)

    def community_or_404(community_id):
        if query_one("SELECT id FROM communities WHERE id = ?", (community_id,)) is None:
            raise ApiError("Community not found.", 404)

    @app.put("/api/me/communities/<int:community_id>")
    @require_user()
    def join_community(community_id):
        community_or_404(community_id)
        db().execute(
            "INSERT OR IGNORE INTO community_memberships (user_id, community_id, created_at) VALUES (?, ?, ?)",
            (g.user["id"], community_id, now_iso()),
        )
        return jsonify({"community_id": community_id, "joined": True})

    @app.delete("/api/me/communities/<int:community_id>")
    @require_user()
    def leave_community(community_id):
        community_or_404(community_id)
        db().execute(
            "DELETE FROM community_memberships WHERE user_id = ? AND community_id = ?",
            (g.user["id"], community_id),
        )
        return jsonify({"community_id": community_id, "joined": False})

    # --- Admin ----------------------------------------------------------------

    @app.get("/api/admin/stats")
    @require_user("admin")
    def admin_stats():
        role_counts = {row["role"]: row["count"] for row in query_all(
            "SELECT role, COUNT(*) AS count FROM users GROUP BY role")}
        return jsonify({
            "users": {role: role_counts.get(role, 0) for role in ROLES},
            "total_events": db().execute("SELECT COUNT(*) FROM events").fetchone()[0],
            "total_registrations": db().execute("SELECT COUNT(*) FROM registrations").fetchone()[0],
            "events_by_organizer": {row["organiser_id"]: row["count"] for row in query_all(
                "SELECT organiser_id, COUNT(*) AS count FROM events GROUP BY organiser_id")},
            "recent_registrations": query_all(
                "SELECT id, event_id, user_id, created_at FROM registrations ORDER BY created_at DESC LIMIT 10"),
        })

    @app.get("/api/admin/users")
    @require_user("admin")
    def admin_list_users():
        page, per_page, offset = parse_pagination()
        total = db().execute("SELECT COUNT(*) FROM users").fetchone()[0]
        users = query_all(
            "SELECT id, name, email, role, created_at FROM users ORDER BY created_at, name LIMIT ? OFFSET ?",
            (per_page, offset),
        )
        return jsonify({"users": users, "total": total, "page": page, "per_page": per_page})

    @app.get("/api/admin/users/<user_id>")
    @require_user("admin")
    def admin_get_user(user_id):
        if not is_uuid(user_id):
            return error_response("Invalid user id.", 400)
        user = query_one("SELECT id, name, email, role, created_at FROM users WHERE id = ?", (user_id,))
        if user is None:
            return error_response("User not found.", 404)
        return jsonify(user)

    @app.patch("/api/admin/users/<user_id>")
    @require_user("admin")
    def admin_update_user(user_id):
        if not is_uuid(user_id):
            return error_response("Invalid user id.", 400)
        payload = request.get_json(silent=True)
        role = payload.get("role") if isinstance(payload, dict) else None
        if role not in ROLES:
            return error_response("Invalid role. Must be attendee, organizer, or admin.", 400)
        with transaction(db()):
            target = query_one("SELECT id, role FROM users WHERE id = ?", (user_id,))
            if target is None:
                raise ApiError("User not found.", 404)
            if target["role"] == "admin" and role != "admin":
                if user_id == g.user["id"]:
                    raise ApiError("You cannot remove your own admin role.", 400)
                if db().execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0] <= 1:
                    raise ApiError("Cannot remove the last admin user.", 400)
            db().execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        return jsonify(query_one("SELECT id, name, email, role, created_at FROM users WHERE id = ?", (user_id,)))

    @app.delete("/api/admin/users/<user_id>")
    @require_user("admin")
    def admin_delete_user(user_id):
        if not is_uuid(user_id):
            return error_response("Invalid user id.", 400)
        with transaction(db()):
            target = query_one("SELECT id, role FROM users WHERE id = ?", (user_id,))
            if target is None:
                raise ApiError("User not found.", 404)
            if user_id == g.user["id"]:
                raise ApiError("You cannot delete your own admin account.", 400)
            if db().execute("SELECT COUNT(*) FROM events WHERE organiser_id = ?", (user_id,)).fetchone()[0]:
                raise ApiError(
                    "This user still owns events. Delete or reassign those events before deleting the user.", 409)
            if target["role"] == "admin" and db().execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0] <= 1:
                raise ApiError("Cannot delete the last admin user.", 400)
            db().execute("DELETE FROM users WHERE id = ?", (user_id,))
        return jsonify({"status": "deleted", "user_id": user_id})

    @app.get("/api/admin/events")
    @require_user("admin")
    def admin_list_events():
        page, per_page, offset = parse_pagination()
        total = db().execute("SELECT COUNT(*) FROM events").fetchone()[0]
        events = query_all(
            EVENT_SELECT + " ORDER BY e.timestamp DESC LIMIT ? OFFSET ?",
            (per_page, offset),
        )
        for event in events:
            event["registration_count"] = registration_count(event["id"])
        return jsonify({"events": events, "total": total, "page": page, "per_page": per_page})

    @app.get("/api/admin/events/<event_id>")
    @require_user("admin")
    def admin_get_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        event = fetch_event(event_id)
        if event is None:
            return error_response("Event not found.", 404)
        event["registration_count"] = registration_count(event_id)
        return jsonify(event)

    @app.delete("/api/admin/events/<event_id>")
    @require_user("admin")
    def admin_delete_event(event_id):
        if not is_uuid(event_id):
            return error_response("Invalid event id.", 400)
        removed = db().execute("DELETE FROM events WHERE id = ?", (event_id,)).rowcount
        if not removed:
            return error_response("Event not found.", 404)
        return jsonify({"status": "deleted", "event_id": event_id})

    @app.get("/api/admin/registrations")
    @require_user("admin")
    def admin_list_registrations():
        page, per_page, offset = parse_pagination()
        total = db().execute("SELECT COUNT(*) FROM registrations").fetchone()[0]
        registrations = query_all(
            """SELECT r.id, r.event_id, r.user_id, r.created_at, e.title AS event_title, u.email AS user_email
               FROM registrations r
               JOIN events e ON e.id = r.event_id
               JOIN users u ON u.id = r.user_id
               ORDER BY r.created_at DESC LIMIT ? OFFSET ?""",
            (per_page, offset),
        )
        return jsonify({"registrations": registrations, "total": total, "page": page, "per_page": per_page})

    # --- Frontend -------------------------------------------------------------

    @app.route("/")
    def serve_index():
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/<path:path>")
    def serve_static(path):
        return send_from_directory(app.static_folder, path)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
        port=int(os.environ.get("PORT", "5002")),
    )
