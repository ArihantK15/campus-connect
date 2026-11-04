# Campus Connect audit

The corrected local prototype preserves the original visual direction and addresses issues found through source review and integrated browser smoke testing.

## Visual and navigation fixes

1. Made the spotlight button text explicitly dark instead of inheriting white text from the hero.
2. Replaced ambiguous clubs, placeholder characters, and emoji with consistent SVG icons.
3. Bundled event photographs locally and replaced the broken pottery image URL.
4. Bundled fonts locally and added explicit sans-serif fallbacks to heading styles.
5. Removed decorative carousel indicators that suggested a nonexistent carousel.
6. Adjusted the spotlight sticker so its message fits without crowding its ornament.
7. Gave My events, Saved events, and Communities their own headings and descriptions; removed the discovery hero from those pages.
8. Added hash navigation so refresh and browser back/forward retain the correct page.
9. Added short labels to mobile navigation, accessible control names, and consistent touch targets.
10. Improved text contrast, filter focus styles, card actions, and the help control layout.
11. Removed a dropdown indicator from the single-campus label; removed the false unread-notification badge.
12. Added a real notifications dialog rather than a transient message.

## Event discovery and calendars

13. Trimmed searches and included subtitles, hosts, descriptions, and locations in search results.
14. Fixed All events counts to reflect the current page instead of always showing eight.
15. Added a live result count, active filter indicator, and Clear all filters control.
16. Reset filters consistently between pages and hid irrelevant controls in Communities.
17. Replaced the misleading “This week” label with a dynamic next-seven-days filter in the campus timezone.
18. Distinguished empty saved/registered pages from searches that returned no matches; clear-filter actions stay on the current page.
19. Labeled the calendar month and campus-local time convention; used a readable agenda on small screens and suppressed empty calendar grids.
20. Calendar downloads use an estimated one-hour duration and escape/fold calendar fields with proper CRLF lines.

## Accounts, registrations, and communities

21. Replaced the unconditional login with verified browser-local accounts using salted PBKDF2 password hashes.
22. Added duplicate-account checks, incorrect-password errors, trimmed names/emails, and a show/hide password control.
23. Separated registrations and community memberships by account; logging out no longer leaves the previous user's registrations visible.
24. Preserved event and community intentions through signup/login instead of losing the action.
25. Made registration idempotent and added a direct View entry pass action in My events.
26. Added cancel-registration confirmation, a keep-my-spot action, and correct count updates.
27. Clearly marks price as unavailable when it is absent from the event data; no payment is collected.
28. Added explicit community leave confirmation and membership state persistence.
29. Provided recovery of the previous prototype's registrations when signing up with the same email in the same browser/origin.
30. Guarded corrupt or blocked local storage so the interface remains usable, with an explanatory message when data cannot persist.

## Accessibility and local setup

31. Replaced nested interactive cards with native, individually named buttons.
32. Labeled dialogs by their headings, trapped keyboard focus, made the background inert, supported Escape, and restored focus after closing.
33. Added a working skip link without interfering with page routing, reduced-motion support, and screen-reader result announcements.
34. Added a Mac launcher that starts the local server on an available localhost port and opens the correct local URL.
35. Updated the calendar to show every event month and events without announced dates instead of silently limiting the desktop view to the first month.
36. Disabled the free-only filter when event pricing is absent from the database, and removed unsupported attendee counts from the spotlight.

## Verification

- The integrated browser smoke test loaded all four Supabase events and confirmed search, category filtering, event details, responsive multi-month calendar mode, seeded-user registration, cancellation, and the no-date calendar message.
- The calendar smoke test exposed missing events outside the first month; the corrected calendar now groups all dated events by month and lists undated events separately.
- Backend checks cover frontend serving, event listing, invalid and missing event IDs, malformed registration bodies, unknown demo users, and duplicate registration responses.
- JavaScript syntax and Python compilation checks pass.

The checks cover the implemented local prototype and are not a guarantee against every possible browser or device issue. Events and event registrations are stored in Supabase. Accounts, saved events, and community memberships remain browser-local. The API identifies demo users by email and uses a server-only service-role key; it is restricted to localhost and is not production authentication. Do not expose it publicly or use it for real attendee data. Production use requires Supabase Auth/JWT verification and user-scoped authorization. Event pricing, locations, and organizer descriptions are not present in the current event API, so the interface identifies them as unavailable rather than inventing values.
