# Campus Connect

Campus Connect is a campus events app: discover events, register, save events,
join communities, and manage events as an organizer or admin. A Flask API
serves both the data and the frontend from one origin, and stores everything in
SQLite. There are no external services and no sign-in.

## Choosing a user

There is no login. The top-right **Viewing as** menu lists the sample users:

- **Admins** (Morgan Ellis): full admin dashboard.
- **Organizers** (Maya Chen, Sam Rivera): create and manage their own events, view attendees, Dashboards menu.
- **Attendees** (Avery Patel, Taylor Brooks): discover, register, save, join communities.
- **Browse as guest**: look around; saving, joining, and registering ask you to pick a user.

The choice is remembered in the browser. The server trusts the chosen user, so
this is a workshop demo, not something to put real personal data into.

## Run locally

```sh
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5002 (set `PORT` to change it). The first run creates
`data/campus_connect.db` and fills it with the sample campus.

Or open `campus-connect/Start.command` on macOS. It runs `start.py`, which opens
the app on a free port.

Tests:

```sh
python -m unittest discover -s tests -v
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `data/campus_connect.db` | SQLite file location |
| `CAMPUS_TIME_ZONE` | `Asia/Kolkata` | Zone used for dates entered without a timezone |
| `PORT` | `5002` | Port for `python app.py` |

Event dates are stored in UTC. The event form sends campus-local times, which
the server converts.

## API

Identity is the `X-User-Id` header. Event reads and the user list are public.

| Method | Path | Who | Behavior |
| --- | --- | --- | --- |
| GET | `/api/users` | public | Sample users for the switcher |
| GET | `/api/me` | any chosen user | The current user |
| GET | `/api/events` | public | List events (`?organiser_id=` filters) |
| GET | `/api/events/{id}` | public | One event |
| POST | `/api/events` | organizer, admin | Create an event |
| PATCH | `/api/events/{id}` | owner, admin | Update fields |
| DELETE | `/api/events/{id}` | owner, admin | Delete an event and its registrations |
| GET | `/api/me/events` | organizer, admin | Events you host |
| GET | `/api/events/{id}/registrations` | owner, admin | Attendees (`?count_only=true` for a count) |
| POST | `/api/registrations` | attendee | Register; 409 if full, duplicate, or past |
| DELETE | `/api/registrations/{event_id}` | attendee | Cancel your registration |
| GET | `/api/me/registrations` | any chosen user | Your registrations |
| GET / PUT / DELETE | `/api/me/saved[/{event_id}]` | any chosen user | Saved events |
| GET | `/api/communities` | public | Communities (with `joined` for the chosen user) |
| PUT / DELETE | `/api/me/communities/{id}` | any chosen user | Join or leave |
| GET | `/api/admin/stats` | admin | Totals by role |
| GET / PATCH / DELETE | `/api/admin/users[/{id}]` | admin | Users; role changes keep at least one admin |
| GET / DELETE | `/api/admin/events[/{id}]` | admin | Events with registration counts |
| GET | `/api/admin/registrations` | admin | All registrations (paged) |
| GET | `/healthz` | public | Health check |

## Deploying on Render

[`render.yaml`](render.yaml) defines a free Python web service. Create it from
Render's Blueprint flow. No secrets are required.

Free Render services have an ephemeral disk. The database is recreated with the
sample data after a redeploy or restart, so user changes do not persist there.
For persistent data, attach a persistent disk and set `DATABASE_PATH` to a path
on it. Free services also sleep after 15 minutes without traffic and take about
a minute to wake.

## Legacy Supabase files

The `supabase/` folder holds the earlier Supabase schema and migrations. The
running app no longer uses them. They are kept only for reference.
