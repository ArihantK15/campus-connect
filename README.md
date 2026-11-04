# Campus Connect

Campus Connect is a Flask-served frontend backed by Supabase Auth and Postgres.
The Flask API verifies Supabase access tokens, serves event data, and performs
user-scoped registration operations with a server-only service-role key.

## Local setup

1. Apply the existing database schema and
   [`supabase/migrations/20261102144458_secure_event_registrations.sql`](supabase/migrations/20261102144458_secure_event_registrations.sql)
   if they are not already installed.
2. Apply [`supabase/migrations/20261104124404_supabase_auth_identity.sql`](supabase/migrations/20261104124404_supabase_auth_identity.sql)
   in the Supabase SQL Editor. It links confirmed Auth users to existing app
   profiles by email, or creates a new attendee profile. Resolve any
   case-insensitive duplicate emails in `public.users` before applying it.
3. In Supabase Auth, enable email confirmations and add your local site URL to
   the allowed redirect URLs. Run `python app.py` for the fixed local address
   `http://127.0.0.1:5002`; the macOS launcher may select another available
   port, which must also be on the redirect allow list.
4. Copy `.env.example` to `.env`. Set `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_KEY`), and
   `SUPABASE_SERVICE_ROLE_KEY`. Never expose or commit the service-role key.
5. Install dependencies with `pip install -r requirements.txt` and run
   `python app.py`, or open [`campus-connect/Start.command`](campus-connect/Start.command).

Hosted Supabase projects require verified email for account linking. Existing
seed emails ending in `.test` cannot receive confirmation messages; use a real
address or a dedicated test identity. User role is taken from `public.users`,
not editable Auth metadata. New signups receive the `attendee` role.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/config` | Return the Supabase URL and publishable key |
| GET | `/api/events` | List events |
| GET | `/api/events/{id}` | Event details |
| GET | `/api/me` | Return the verified user's linked app profile |
| POST | `/api/registrations` | Register the authenticated attendee; returns 201 or 409 |
| DELETE | `/api/registrations/{event_id}` | Cancel the authenticated attendee's registration |
| GET | `/api/me/registrations` | List the authenticated user's registrations |
| GET | `/api/events/{id}/registrations` | Organizer-only attendee list for their own event |

Protected endpoints require `Authorization: Bearer <Supabase access token>`.
Event reads are public; registration ownership and organizer access are
validated against the authenticated user mapped in `public.users`.

## Tests

Run the API authorization tests with:

```sh
python -m unittest discover -s tests -v
```

## Authentication and deployment status

The old email-header demo identity endpoints have been removed from the Auth
branch. Do not deploy until the Auth identity migration is applied and verified,
email confirmation and redirect URLs are configured, and the signup/login,
registration, cancellation, and organizer flows have been tested against the
target Supabase project. The migration is not applied automatically by this
repository.

The public GitHub repository does not contain `.env`. [`render.yaml`](render.yaml)
prepares a free Render web service that serves Flask and the frontend on one
origin. Create it from Render's Blueprint flow only after the checks above pass,
then enter the three Supabase values when prompted. Render's free service sleeps
after 15 minutes without traffic and can take about a minute to wake; its file
system is ephemeral. Supabase's free plan may pause inactive projects. These
plans are suitable for demos, not production reliability; review current
provider limits before relying on them.
