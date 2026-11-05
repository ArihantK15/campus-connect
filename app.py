import base64
import binascii
import json
import math
import os
from functools import wraps
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory
from httpx import HTTPError
from postgrest import APIError
from supabase import Client, create_client
from supabase_auth.errors import AuthApiError, AuthError

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

app = Flask(__name__, static_folder=str(PROJECT_ROOT / "campus-connect"), static_url_path="")

supabase_public: Client | None = None
supabase: Client | None = None
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def is_service_role_key(value: str | None) -> bool:
    if not value:
        return False
    if value == SUPABASE_SERVICE_ROLE_KEY or value.startswith("sb_secret_"):
        return True
    parts = value.split(".")
    if len(parts) != 3:
        return False
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    return isinstance(claims, dict) and claims.get("role") == "service_role"


if SUPABASE_URL:
    if SUPABASE_PUBLISHABLE_KEY and not is_service_role_key(SUPABASE_PUBLISHABLE_KEY):
        supabase_public = create_client(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    if SUPABASE_SERVICE_ROLE_KEY:
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def database(client):
    if client is None:
        return jsonify({"error": "Supabase is not configured. Set SUPABASE_URL and the required API key."}), 503
    return None


def is_valid_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def get_one(client: Client, table: str, columns: str, field: str, value: str):
    """Fetch at most one row without PostgREST's maybe-single empty-result edge case."""
    response = client.table(table).select(columns).eq(field, value).limit(1).execute()
    return response.data[0] if response.data else None


def require_auth(view):
    @wraps(view)
    def authenticated_view(*args, **kwargs):
        unavailable = database(supabase_public)
        if unavailable:
            return unavailable
        unavailable = database(supabase)
        if unavailable:
            return unavailable

        authorization = request.headers.get("Authorization", "")
        scheme, separator, token = authorization.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token.strip():
            return jsonify({"error": "A valid Supabase access token is required."}), 401

        try:
            response = supabase_public.auth.get_user(token.strip())
            auth_user = response.user if response else None
            if auth_user is None:
                return jsonify({"error": "The Supabase session is invalid or expired."}), 401
            if not auth_user.email_confirmed_at:
                return jsonify({"error": "Verify your email address before continuing."}), 403

            app_user = get_one(supabase, "users", "id,email,role,auth_user_id", "auth_user_id", str(auth_user.id))
        except AuthApiError as error:
            if error.status >= 500:
                app.logger.error("Supabase Auth request failed (status=%s)", error.status)
                return jsonify({"error": "Authentication service is unavailable."}), 503
            return jsonify({"error": "The Supabase session is invalid or expired."}), 401
        except AuthError:
            return jsonify({"error": "The Supabase session is invalid or expired."}), 401
        except APIError as error:
            return api_error(error)
        except HTTPError:
            app.logger.warning("Supabase Auth is unreachable")
            return jsonify({"error": "Authentication service is unavailable."}), 503

        if app_user is None:
            return jsonify({"error": "Your verified account is not linked to an application profile."}), 403

        g.auth_user = auth_user
        g.app_user = app_user
        return view(*args, **kwargs)

    return authenticated_view


def require_admin(view):
    """Require a verified, linked account with the database-backed admin role."""
    @require_auth
    @wraps(view)
    def admin_view(*args, **kwargs):
        if g.app_user.get("role") != "admin":
            return jsonify({"error": "Admin access required."}), 403
        return view(*args, **kwargs)
    return admin_view


def pagination_args():
    """Parse bounded admin pagination parameters without leaking ValueError."""
    try:
        page = int(request.args.get("page", "1"))
        per_page = int(request.args.get("per_page", "20"))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "page and per_page must be integers."}), 400)
    if page < 1 or per_page < 1:
        return None, (jsonify({"error": "page and per_page must be positive."}), 400)
    per_page = min(per_page, 100)
    return (page, per_page, (page - 1) * per_page), None


def validate_event_fields(payload, *, partial=False):
    """Validate event fields shared by create and update routes."""
    allowed_fields = {"title", "capacity", "timestamp", "description", "location", "price", "image_url"}
    unknown = set(payload) - allowed_fields
    if unknown:
        return None, jsonify({"error": f"Unknown event field: {sorted(unknown)[0]}."}), 400
    result = {}
    if not partial or "title" in payload:
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            return None, jsonify({"error": "Title is required and cannot be empty."}), 400
        result["title"] = title.strip()
    if "capacity" in payload:
        value = payload["capacity"]
        if value is not None and (type(value) is not int or value < 0):
            return None, jsonify({"error": "Capacity must be a non-negative integer or null."}), 400
        result["capacity"] = value
    if "timestamp" in payload:
        value = payload["timestamp"]
        if value is not None:
            if not isinstance(value, str):
                return None, jsonify({"error": "Timestamp must be an ISO 8601 string or null."}), 400
            try:
                from datetime import datetime
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None, jsonify({"error": "Invalid timestamp format. Use ISO 8601."}), 400
            if parsed.tzinfo is None:
                return None, jsonify({"error": "Timestamp must include a timezone."}), 400
        result["timestamp"] = value
    for field in ("description", "location", "image_url"):
        if field in payload:
            value = payload[field]
            if value is not None and not isinstance(value, str):
                return None, jsonify({"error": f"{field} must be a string or null."}), 400
            if field == "image_url" and value:
                from posixpath import normpath
                from urllib.parse import urlparse
                parsed = urlparse(value)
                if parsed.scheme or parsed.netloc:
                    if parsed.scheme not in ("http", "https") or not parsed.netloc:
                        return None, jsonify({"error": "image_url must use HTTP or HTTPS."}), 400
                else:
                    relative_path = normpath(value)
                    if (
                        not relative_path.startswith("assets/")
                        or relative_path.startswith("../")
                        or "\\" in value
                        or parsed.query
                        or parsed.fragment
                    ):
                        return None, jsonify({"error": "image_url must be an HTTP(S) URL or a path under assets/."}), 400
            result[field] = value.strip() if isinstance(value, str) else value
    if "price" in payload:
        value = payload["price"]
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or value < 0
            or (isinstance(value, float) and not math.isfinite(value))
        ):
            return None, jsonify({"error": "Price must be a non-negative number or null."}), 400
        result["price"] = value
    return result, None, None


def api_error(error: APIError):
    # Unique constraint violations are the API's documented duplicate response.
    if getattr(error, "code", None) == "23505":
        return jsonify({"error": "You are already registered for this event."}), 409
    app.logger.error("Supabase request failed (code=%s): %s", getattr(error, "code", None), getattr(error, "message", str(error)))
    return jsonify({"error": "Database request failed."}), 500


@app.get("/api/events")
def list_events():
    unavailable = database(supabase_public)
    if unavailable:
        return unavailable
    try:
        # Check if organiser_id filter is requested (for organizer dashboard)
        organiser_id = request.args.get("organiser_id")
        
        query = supabase_public.table("events").select("id,organiser_id,title,capacity,timestamp,description,location,price,image_url,created_at")
        
        if organiser_id:
            if not is_valid_uuid(organiser_id):
                return jsonify({"error": "Invalid organiser_id."}), 400
            query = query.eq("organiser_id", organiser_id)
        
        response = query.order("timestamp").execute()
        return jsonify(response.data or [])
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/me/events")
@require_auth
def current_user_events():
    if g.app_user.get("role") not in ("organizer", "admin"):
        return jsonify({"error": "Only organizers and admins can view organizer events."}), 403
    try:
        response = (
            supabase.table("events")
            .select("id,organiser_id,title,capacity,timestamp,description,location,price,image_url,created_at")
            .eq("organiser_id", g.app_user["id"])
            .order("timestamp")
            .execute()
        )
        rows = response.data or []
        for event in rows:
            event["organiser_email"] = g.app_user["email"]
        return jsonify(rows)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.post("/api/events")
@require_auth
def create_event():
    """Create a new event (organizer or admin only)."""
    if g.app_user.get("role") not in ("organizer", "admin"):
        return jsonify({"error": "Only organizers and admins can create events."}), 403

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON object is required."}), 400

    event_data, error, status = validate_event_fields(payload)
    if error:
        return error, status

    try:
        # Use service role client to insert event
        event_data["organiser_id"] = g.app_user["id"]

        response = supabase.table("events").insert(event_data).select("id,organiser_id,title,capacity,timestamp,description,location,price,image_url,created_at").execute()
        if not response.data:
            return jsonify({"error": "Failed to create event."}), 500
        return jsonify(response.data[0]), 201
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/config")
def public_config():
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY or is_service_role_key(SUPABASE_PUBLISHABLE_KEY):
        return jsonify({"error": "Set SUPABASE_URL and a publishable/anon key; a service-role key cannot be exposed."}), 503
    return jsonify({
        "supabase_url": SUPABASE_URL,
        "publishable_key": SUPABASE_PUBLISHABLE_KEY,
    })


@app.get("/healthz")
def healthcheck():
    if not SUPABASE_URL or supabase_public is None or supabase is None:
        return jsonify({"status": "unavailable"}), 503
    return jsonify({"status": "ok"})


@app.get("/api/events/<event_id>")
def get_event(event_id):
    unavailable = database(supabase_public)
    if unavailable:
        return unavailable
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    try:
        event = get_one(supabase_public, "events", "id,organiser_id,title,capacity,timestamp,description,location,price,image_url,created_at", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        return jsonify(event)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.patch("/api/events/<event_id>")
@require_auth
def update_event(event_id):
    """Update an event (organizer who created it or admin only)."""
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON object is required."}), 400
    update_data, error, status = validate_event_fields(payload, partial=True)
    if error:
        return error, status
    if not update_data:
        return jsonify({"error": "At least one event field is required."}), 400

    try:
        event = get_one(supabase, "events", "id,organiser_id", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404

        # Check permissions: organizer who created it or admin
        if g.app_user.get("role") != "admin" and event.get("organiser_id") != g.app_user["id"]:
            return jsonify({"error": "Only the event organizer or admin can update this event."}), 403

        response = supabase.table("events").update(update_data).eq("id", event_id).select("id,organiser_id,title,capacity,timestamp,description,location,price,image_url,created_at").execute()
        if not response.data:
            return jsonify({"error": "Event not found."}), 404
        return jsonify(response.data[0])
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.delete("/api/events/<event_id>")
@require_auth
def delete_event(event_id):
    """Delete an event (organizer who created it or admin only)."""
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400

    try:
        event = get_one(supabase, "events", "id,organiser_id", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404

        # Check permissions: organizer who created it or admin
        if g.app_user.get("role") != "admin" and event.get("organiser_id") != g.app_user["id"]:
            return jsonify({"error": "Only the event organizer or admin can delete this event."}), 403

        # Delete associated registrations first
        supabase.table("registrations").delete().eq("event_id", event_id).execute()

        response = supabase.table("events").delete().eq("id", event_id).execute()
        if not response.data:
            return jsonify({"error": "Event not found."}), 404
        return jsonify({"status": "deleted", "event_id": event_id})
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.post("/api/registrations")
@require_auth
def create_registration():
    if g.app_user.get("role") != "attendee":
        return jsonify({"error": "Only attendees can register for events."}), 403
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON object is required."}), 400
    event_id = payload.get("event_id")
    if not is_valid_uuid(event_id):
        return jsonify({"error": "A valid event_id is required."}), 400
    try:
        event = get_one(supabase, "events", "id,capacity", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404

        response = supabase.rpc("register_for_event", {
            "p_event_id": event_id,
            "p_user_id": g.app_user["id"],
        }).execute()
        result = response.data
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict):
            app.logger.error("Registration RPC returned an invalid response")
            return jsonify({"error": "Registration could not be confirmed."}), 500
        if result.get("status") == "event_not_found":
            return jsonify({"error": "Event not found."}), 404
        if result.get("status") == "already_registered":
            return jsonify({"error": "You are already registered for this event."}), 409
        if result.get("status") == "event_full":
            return jsonify({"error": "This event is full."}), 409
        if result.get("status") != "created" or not isinstance(result.get("registration"), dict):
            app.logger.error("Registration RPC returned an unexpected status")
            return jsonify({"error": "Registration could not be confirmed."}), 500
        return jsonify(result["registration"]), 201
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503
    except (TypeError, KeyError, IndexError) as error:
        app.logger.error("Unexpected registration response: %s", error)
        return jsonify({"error": "Registration failed."}), 500


@app.delete("/api/registrations/<event_id>")
@require_auth
def cancel_registration(event_id):
    if g.app_user.get("role") != "attendee":
        return jsonify({"error": "Only attendees can cancel event registrations."}), 403
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    try:
        response = (
            supabase.table("registrations")
            .delete()
            .eq("event_id", event_id)
            .eq("user_id", g.app_user["id"])
            .select("id")
            .execute()
        )
        if not response.data:
            return jsonify({"error": "Registration not found."}), 404
        return jsonify({"event_id": event_id, "status": "cancelled"})
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/me/registrations")
@require_auth
def current_user_registrations():
    try:
        response = (supabase.table("registrations")
            .select("id,event_id,user_id,createdAt")
            .eq("user_id", g.app_user["id"])
            .order("createdAt", desc=True)
            .execute())
        return jsonify(response.data)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/events/<event_id>/registrations")
@require_auth
def event_registrations(event_id):
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    try:
        if g.app_user.get("role") not in ("organizer", "admin"):
            return jsonify({"error": "Only organizers and admins can view attendee lists."}), 403
        event = get_one(supabase, "events", "id,organiser_id", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        if g.app_user.get("role") != "admin" and event.get("organiser_id") != g.app_user["id"]:
            return jsonify({"error": "Only the event organizer can view this list."}), 403
        if request.args.get("count_only", "").lower() == "true":
            response = (
                supabase.table("registrations")
                .select("id", count="exact")
                .eq("event_id", event_id)
                .execute()
            )
            return jsonify({"count": response.count or 0})
        response = (
            supabase.table("registrations")
            .select("id,event_id,user_id,createdAt")
            .eq("event_id", event_id)
            .order("createdAt")
            .execute()
        )
        registrations = response.data or []
        user_ids = list({row.get("user_id") for row in registrations if row.get("user_id")})
        users = {}
        if user_ids:
            user_response = supabase.table("users").select("id,email").in_("id", user_ids).execute()
            users = {row["id"]: row["email"] for row in user_response.data or []}
        for registration in registrations:
            registration["user_email"] = users.get(registration.get("user_id"), "Unknown")
        return jsonify(registrations)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/me")
@require_auth
def current_user():
    metadata = g.auth_user.user_metadata
    if not isinstance(metadata, dict):
        metadata = {}
    display_name = metadata.get("display_name")
    if not isinstance(display_name, str) or not display_name.strip():
        display_name = g.app_user["email"].split("@", 1)[0]
    return jsonify({
        "id": str(g.auth_user.id),
        "email": g.app_user["email"],
        "name": display_name.strip()[:60],
        "role": g.app_user["role"],
    })


# Admin API endpoints
@app.get("/api/admin/stats")
@require_admin
def admin_stats():
    """Get system-wide statistics for admin dashboard."""
    try:
        # Total users by role
        users_response = supabase.table("users").select("role").execute()
        users = users_response.data or []
        role_counts = {}
        for user in users:
            role = user.get("role", "unknown")
            role_counts[role] = role_counts.get(role, 0) + 1

        # Total events
        events_response = supabase.table("events").select("id", count="exact").execute()
        total_events = events_response.count or 0

        # Total registrations
        regs_response = supabase.table("registrations").select("id", count="exact").execute()
        total_registrations = regs_response.count or 0

        # Events by organizer
        events_by_org = supabase.table("events").select("organiser_id").execute()
        org_event_counts = {}
        for event in events_by_org.data or []:
            org_id = event.get("organiser_id")
            org_event_counts[org_id] = org_event_counts.get(org_id, 0) + 1

        # Recent registrations (last 10)
        recent_regs = supabase.table("registrations").select("id,event_id,user_id,createdAt").order("createdAt", desc=True).limit(10).execute()

        return jsonify({
            "users": role_counts,
            "total_events": total_events,
            "total_registrations": total_registrations,
            "events_by_organizer": org_event_counts,
            "recent_registrations": recent_regs.data or [],
        })
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/admin/users")
@require_admin
def admin_list_users():
    pagination, error = pagination_args()
    if error:
        return error
    page, per_page, offset = pagination
    try:
        response = supabase.table("users").select("id,email,role,auth_user_id,created_at", count="exact").range(offset, offset + per_page - 1).order("created_at", desc=True).execute()

        return jsonify({
            "users": response.data or [],
            "total": response.count or 0,
            "page": page,
            "per_page": per_page,
        })
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/admin/users/<user_id>")
@require_admin
def admin_get_user(user_id):
    """Get a specific user by ID."""
    if not is_valid_uuid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    try:
        user = get_one(supabase, "users", "id,email,role,auth_user_id,created_at", "id", user_id)
        if user is None:
            return jsonify({"error": "User not found."}), 404
        return jsonify(user)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.patch("/api/admin/users/<user_id>")
@require_admin
def admin_update_user(user_id):
    """Update a user's role."""
    if not is_valid_uuid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON object is required."}), 400

    role = payload.get("role")
    if role not in ("attendee", "organizer", "admin"):
        return jsonify({"error": "Invalid role. Must be attendee, organizer, or admin."}), 400

    try:
        current_user = get_one(supabase, "users", "id,role", "id", user_id)
        if current_user is None:
            return jsonify({"error": "User not found."}), 404
        if user_id == g.app_user["id"] and role != "admin":
            return jsonify({"error": "You cannot remove your own admin role."}), 400
        # Prevent removing the last admin
        if role != "admin":
            admin_count = supabase.table("users").select("id", count="exact").eq("role", "admin").execute()
            if (admin_count.count or 0) <= 1:
                if current_user.get("role") == "admin":
                    return jsonify({"error": "Cannot remove the last admin user."}), 400

        response = supabase.table("users").update({"role": role}).eq("id", user_id).select("id,email,role,auth_user_id,created_at").execute()
        if not response.data:
            return jsonify({"error": "User not found."}), 404
        return jsonify(response.data[0])
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.delete("/api/admin/users/<user_id>")
@require_admin
def admin_delete_user(user_id):
    """Delete a user (admin only)."""
    if not is_valid_uuid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    try:
        current_user = get_one(supabase, "users", "id,role", "id", user_id)
        if current_user is None:
            return jsonify({"error": "User not found."}), 404
        if user_id == g.app_user["id"]:
            return jsonify({"error": "You cannot delete your own admin account."}), 400
        owned_events = (
            supabase.table("events")
            .select("id", count="exact")
            .eq("organiser_id", user_id)
            .execute()
        )
        if (owned_events.count or 0) > 0:
            return jsonify({
                "error": "This user still owns events. Delete or reassign those events before deleting the user."
            }), 409
        # Prevent deleting the last admin
        admin_count = supabase.table("users").select("id", count="exact").eq("role", "admin").execute()
        if (admin_count.count or 0) <= 1:
            if current_user.get("role") == "admin":
                return jsonify({"error": "Cannot delete the last admin user."}), 400

        # Also delete associated registrations
        supabase.table("registrations").delete().eq("user_id", user_id).execute()

        response = supabase.table("users").delete().eq("id", user_id).execute()
        if not response.data:
            return jsonify({"error": "User not found."}), 404
        return jsonify({"status": "deleted", "user_id": user_id})
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/admin/events")
@require_admin
def admin_list_events():
    pagination, error = pagination_args()
    if error:
        return error
    page, per_page, offset = pagination
    try:
        response = supabase.table("events").select("id,organiser_id,title,capacity,timestamp,created_at", count="exact").range(offset, offset + per_page - 1).order("timestamp", desc=True).execute()

        # Get organizer emails for each event
        organiser_ids = list(set(e.get("organiser_id") for e in response.data or [] if e.get("organiser_id")))
        organisers = {}
        if organiser_ids:
            org_response = supabase.table("users").select("id,email").in_("id", organiser_ids).execute()
            organisers = {o["id"]: o["email"] for o in org_response.data or []}

        events = response.data or []
        event_ids = [event["id"] for event in events]
        registration_counts = {event_id: 0 for event_id in event_ids}
        if event_ids:
            offset = 0
            total = None
            while total is None or offset < total:
                registrations = (
                    supabase.table("registrations")
                    .select("event_id", count="exact")
                    .in_("event_id", event_ids)
                    .range(offset, offset + 999)
                    .execute()
                )
                rows = registrations.data or []
                for registration in rows:
                    registration_counts[registration["event_id"]] += 1
                total = registrations.count or 0
                offset += len(rows)
                if not rows:
                    break
        for event in events:
            event["organiser_email"] = organisers.get(event.get("organiser_id"), "Unknown")
            event["registration_count"] = registration_counts.get(event["id"], 0)

        return jsonify({
            "events": events,
            "total": response.count or 0,
            "page": page,
            "per_page": per_page,
        })
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/admin/events/<event_id>")
@require_admin
def admin_get_event(event_id):
    """Get a specific event by ID (admin view)."""
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    try:
        event = get_one(supabase, "events", "id,organiser_id,title,capacity,timestamp,created_at", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404

        # Get organizer email
        if event.get("organiser_id"):
            org = get_one(supabase, "users", "email", "id", event["organiser_id"])
            event["organiser_email"] = org.get("email") if org else "Unknown"

        # Get registration count
        reg_count = supabase.table("registrations").select("id", count="exact").eq("event_id", event_id).execute()
        event["registration_count"] = reg_count.count or 0

        return jsonify(event)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.delete("/api/admin/events/<event_id>")
@require_admin
def admin_delete_event(event_id):
    """Delete an event (admin only)."""
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    try:
        # Delete associated registrations first
        supabase.table("registrations").delete().eq("event_id", event_id).execute()

        response = supabase.table("events").delete().eq("id", event_id).execute()
        if not response.data:
            return jsonify({"error": "Event not found."}), 404
        return jsonify({"status": "deleted", "event_id": event_id})
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/admin/registrations")
@require_admin
def admin_list_registrations():
    pagination, error = pagination_args()
    if error:
        return error
    page, per_page, offset = pagination
    try:
        response = supabase.table("registrations").select("id,event_id,user_id,createdAt", count="exact").range(offset, offset + per_page - 1).order("createdAt", desc=True).execute()

        # Get event titles and user emails
        event_ids = list(set(r.get("event_id") for r in response.data or [] if r.get("event_id")))
        user_ids = list(set(r.get("user_id") for r in response.data or [] if r.get("user_id")))

        events = {}
        if event_ids:
            ev_response = supabase.table("events").select("id,title").in_("id", event_ids).execute()
            events = {e["id"]: e["title"] for e in ev_response.data or []}

        users = {}
        if user_ids:
            usr_response = supabase.table("users").select("id,email").in_("id", user_ids).execute()
            users = {u["id"]: u["email"] for u in usr_response.data or []}

        registrations = response.data or []
        for reg in registrations:
            reg["event_title"] = events.get(reg.get("event_id"), "Unknown")
            reg["user_email"] = users.get(reg.get("user_id"), "Unknown")

        return jsonify({
            "registrations": registrations,
            "total": response.count or 0,
            "page": page,
            "per_page": per_page,
        })
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify({"error": "Method not allowed."}), 405


# Serve frontend
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
        port=int(os.environ.get("PORT", "5002")),
    )
