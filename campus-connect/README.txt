Campus Connect — corrected local prototype

RUN ON YOUR MAC
1. Keep this folder inside the New1 project folder so the Flask backend and
   Supabase configuration are available in the parent directory.
2. Install the project dependencies from the parent folder with:
       pip install -r requirements.txt
3. Double-click Start.command. It starts Flask (API + frontend) on one local
   origin and opens your browser. Keep the Terminal window open while using it.

If macOS will not open Start.command:
Open Terminal, type cd followed by a space, drag this folder into Terminal,
press Return, then run:
    python3 start.py

Python 3 and the parent project's dependencies are required. The launcher
chooses an available local port and opens its URL. Always use the URL printed
by the launcher.

UPDATING THE PREVIOUS VERSION
Reload with Command+Shift+R after replacing the files, or use the new folder.
Create a local demo account with your previous email to recover old registrations
and saved events from the previous prototype. Recovery requires the same browser
and the same local origin (including port). Old profiles did not have verified
passwords, so they cannot be logged into until a local account is created.

WHAT THIS DEMO DOES
- Event discovery, search, date and price filters, saved events
- Local demo signups and password-verified logins; only seeded demo identities
  have Supabase data
- Supabase-backed registration, entry passes, cancellation, and calendar files
- Community membership with signup continuation and leave confirmation
- Responsive cards and mobile calendar agenda, keyboard-accessible dialogs

LOCAL DATA
Use a sample password; this is not production or university authentication.
Passwords are hashed with PBKDF2 and a random salt. All account data stays in
this browser. Clearing site storage removes accounts and plans. Other devices
and browsers do not share this local login. Event registrations are stored in
Supabase. With browser storage blocked, local account data lasts only until the
page is closed or reloaded. No emails are sent or payments taken.

This is a localhost demo. The API uses demo email identities and a server-only
service-role key; do not expose it publicly or use it for real attendee data.
Production use requires Supabase Auth/JWT verification and user-scoped access.

Assets are included, so the local site does not need external font or image
requests. Font licenses and image source references are in assets/.

See FIXES.md for the audit and verification summary.
