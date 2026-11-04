import os
import re
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from httpx import HTTPError
from postgrest import APIError
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

app = Flask(__name__, static_folder=str(PROJECT_ROOT / "campus-connect"), static_url_path="")

supabase_public: Client | None = None
supabase: Client | None = None
if os.environ.get("SUPABASE_URL"):
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_KEY")
    if publishable_key:
        supabase_public = create_client(os.environ["SUPABASE_URL"], publishable_key)
    if os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


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


def is_valid_email(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) <= 254
        and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value) is not None
    )


def get_one(client: Client, table: str, columns: str, field: str, value: str):
    """Fetch at most one row without PostgREST's maybe-single empty-result edge case."""
    response = client.table(table).select(columns).eq(field, value).limit(1).execute()
    return response.data[0] if response.data else None


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
def create_registration():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "A JSON object is required."}), 400
    event_id = payload.get("event_id")
    email = payload.get("email")
    if not is_valid_uuid(event_id):
        return jsonify({"error": "A valid event_id is required."}), 400
    if not is_valid_email(email.strip() if isinstance(email, str) else email):
        return jsonify({"error": "A valid email is required."}), 400
    email = email.strip().lower()
    unavailable = database(supabase)
    if unavailable:
        return unavailable
    try:
        event = get_one(supabase, "events", "id,capacity", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        user = get_one(supabase, "users", "id", "email", email)
        if user is None:
            return jsonify({"error": "Demo user not found. Use an email from the seeded users."}), 404
        if not user.get("id"):
            return jsonify({"error": "Invalid user data."}), 500

        response = supabase.rpc("register_for_event", {
            "p_event_id": event_id,
            "p_user_id": user["id"],
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
def cancel_registration(event_id):
    unavailable = database(supabase)
    if unavailable:
        return unavailable
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    email = request.headers.get("X-User-Email", "").strip().lower()
    if not is_valid_email(email):
        return jsonify({"error": "Provide X-User-Email to identify the demo user."}), 400
    try:
        user = get_one(supabase, "users", "id", "email", email)
        if user is None:
            return jsonify({"error": "Demo user not found."}), 404
        response = (
            supabase.table("registrations")
            .delete()
            .eq("event_id", event_id)
            .eq("user_id", user["id"])
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
def current_user_registrations():
    """Demo identity is supplied as X-User-Email because auth is out of scope."""
    unavailable = database(supabase)
    if unavailable:
        return unavailable
    email = request.headers.get("X-User-Email", "").strip().lower()
    if not is_valid_email(email):
        return jsonify({"error": "Provide X-User-Email to identify the demo user."}), 400
    try:
        user = get_one(supabase, "users", "id", "email", email)
        if user is None:
            return jsonify({"error": "Demo user not found."}), 404
        if not user.get("id"):
            return jsonify({"error": "Invalid user data."}), 500
        response = (supabase.table("registrations")
            .select("id,event_id,user_id,createdAt")
            .eq("user_id", user["id"])
            .order("createdAt", desc=True)
            .execute())
        return jsonify(response.data)
    except APIError as error:
        return api_error(error)
    except HTTPError:
        app.logger.warning("Supabase is unreachable")
        return jsonify({"error": "Supabase is unreachable."}), 503


@app.get("/api/events/<event_id>/registrations")
def event_registrations(event_id):
    """Demo organizer identity is supplied as X-Organizer-Email; no auth is added."""
    unavailable = database(supabase)
    if unavailable:
        return unavailable
    if not is_valid_uuid(event_id):
        return jsonify({"error": "Invalid event id."}), 400
    email = request.headers.get("X-Organizer-Email", "").strip().lower()
    if not is_valid_email(email):
        return jsonify({"error": "Provide X-Organizer-Email to identify the demo organizer."}), 400
    try:
        event = get_one(supabase, "events", "id,organiser_id", "id", event_id)
        if event is None:
            return jsonify({"error": "Event not found."}), 404
        organiser = get_one(supabase, "users", "id", "email", email)
        if organiser is None or not organiser.get("id") or event.get("organiser_id") != organiser["id"]:
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
