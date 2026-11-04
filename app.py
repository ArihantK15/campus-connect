import base64
import binascii
import json
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
        response = (
            supabase_public.table("events")
            .select("id,title,capacity,timestamp")
            .order("timestamp")
            .execute()
        )
        return jsonify(response.data)
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
        event = get_one(supabase_public, "events", "id,title,capacity,timestamp", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        return jsonify(event)
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
        if g.app_user.get("role") != "organizer":
            return jsonify({"error": "Only organizers can view attendee lists."}), 403
        event = get_one(supabase, "events", "id,organiser_id", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        if event.get("organiser_id") != g.app_user["id"]:
            return jsonify({"error": "Only the event organizer can view this list."}), 403
        response = (
            supabase.table("registrations")
            .select("id,event_id,user_id,createdAt")
            .eq("event_id", event_id)
            .order("createdAt")
            .execute()
        )
        return jsonify(response.data)
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
