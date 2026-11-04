# Event registration API

Small Flask + Supabase demo matching the event API contract. Authentication is
intentionally omitted; identity-dependent demo endpoints use request headers.

## Setup

Create the `events` and `registrations` tables with the existing project schema,
then run [`supabase/seed.sql`](supabase/seed.sql) in the Supabase SQL Editor. It
seeds five demo rows in `users`, three events, and four registrations using the
existing schema. It is safe to run again. The user rows are app data only; the
script does not create Supabase Auth users or add authentication.

Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-only: never put it
in frontend code or commit it. Event reads use the publishable key; the remaining
API endpoints need the service-role key because RLS blocks direct access to user
and registration rows.

Install the project dependencies with `pip install -r requirements.txt`, then
run `python app.py` from this directory and open `http://127.0.0.1:5002`. Or
launch [`campus-connect/Start.command`](campus-connect/Start.command), which
starts the API and frontend on one local origin using an available port.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/events` | List events |
| GET | `/api/events/{id}` | Event details |
| POST | `/api/registrations` | Create a registration for a seeded demo user; returns 201 or 409 |
| DELETE | `/api/registrations/{event_id}` | Cancel the identified demo user's registration |
| GET | `/api/me/registrations` | Registrations matching `X-User-Email` |
| GET | `/api/events/{id}/registrations` | Attendee rows when `X-Organizer-Email` matches the event organiser |

Example registration body:

```json
{"event_id":"11111111-1111-4111-8111-111111111111","email":"attendee.one@example.test"}
```

For example, `curl -H 'X-User-Email: attendee.one@example.test' http://127.0.0.1:5002/api/me/registrations`.

This project remains a local demo, not a production authentication system.
Browser passwords are local-only; the API accepts demo email identities and
uses the service-role key. Keep the server bound to localhost and never expose
real attendee data or deploy these identity-header endpoints publicly. A
production launch needs Supabase Auth/JWT verification and user-scoped
authorization before network exposure.

## GitHub and deployment

The public source repository excludes `.env`, local virtual environments, and
editor/agent state. Never commit credentials. Deployment is intentionally not
configured yet: the current email-header identity model is for local demos only.
Do not expose the Flask API to the public internet until Supabase Auth/JWT
verification and user-scoped authorization have replaced that model.

Once authentication is secured, a free Render web service can host Flask and
serve the frontend from the same origin. Add the Supabase variables in Render's
environment settings, never in the repository. Render's free service sleeps
after 15 minutes without traffic and can take about a minute to wake. Supabase's
free plan may pause inactive projects and does not provide downloadable database
backups; see the provider's current plan terms before relying on it.
