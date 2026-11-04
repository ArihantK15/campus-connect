Campus Connect

RUN LOCALLY
1. Keep this folder inside the New1 project folder so Flask, Supabase settings,
   and database migrations are available from the parent directory.
2. Apply the Supabase Auth identity migration and configure email confirmation
   and allowed redirect URLs. See the parent README for the required steps.
3. Install dependencies from the parent project folder:
       pip install -r requirements.txt
4. Run `python app.py` from the parent folder, or double-click Start.command.
   The launcher uses a local port selected at startup; use the URL it prints.
   For email-confirmation redirects, allow that origin in Supabase Auth.

AUTHENTICATION AND DATA
- Supabase Auth handles account signup, login, email verification, and sessions.
- The Flask API verifies bearer tokens and maps confirmed users to `public.users`.
- Events and registrations are stored in Supabase. Registrations are private to
  the authenticated attendee; organizers can view attendees for their own events.
- Saved events and community preferences are stored only in this browser.
- New accounts receive the attendee role. Organizer roles must be assigned by
  a trusted database administrator, never by browser metadata.

This application is not affiliated with a real university. No payments are
collected. Calendar invite duration is estimated; event details depend on the
data configured in Supabase.

See FIXES.md for earlier frontend improvements and the parent README for setup,
database migration, security, and deployment status.
