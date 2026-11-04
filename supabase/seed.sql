-- Mock event registration data for the existing public.events and
-- public.registrations tables. Re-runnable: all seeded rows use stable IDs.
-- These UUIDs are demo identities in public.users; no Supabase Auth users are created.

begin;

insert into public.users (id, email, role)
values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organizer.one@example.test', 'organizer'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'organizer.two@example.test', 'organizer'),
    ('c1111111-1111-4111-8111-111111111111', 'attendee.one@example.test', 'attendee'),
    ('c2222222-2222-4222-8222-222222222222', 'attendee.two@example.test', 'attendee'),
    ('c3333333-3333-4333-8333-333333333333', 'attendee.three@example.test', 'attendee')
on conflict (id) do update set
    email = excluded.email,
    role = excluded.role;

insert into public.events (id, organiser_id, title, capacity, "timestamp")
values
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'Product Builders Meetup', 120, '2027-02-18 18:30:00+05:30'),
    ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'Design Systems Workshop', 40, '2027-03-06 10:00:00+05:30'),
    ('33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
     'Open Source Community Night', 200, '2027-03-20 17:00:00+05:30')
on conflict (id) do update set
    organiser_id = excluded.organiser_id,
    title = excluded.title,
    capacity = excluded.capacity,
    "timestamp" = excluded."timestamp";

insert into public.registrations (id, user_id, event_id, "createdAt")
values
    ('a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111',
     '11111111-1111-4111-8111-111111111111', '2026-10-01 09:00:00+05:30'),
    ('a2222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222222',
     '11111111-1111-4111-8111-111111111111', '2026-10-02 10:30:00+05:30'),
    ('a3333333-3333-4333-8333-333333333333', 'c1111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222', '2026-10-03 12:00:00+05:30'),
    ('a4444444-4444-4444-8444-444444444444', 'c3333333-3333-4333-8333-333333333333',
     '33333333-3333-4333-8333-333333333333', '2026-10-04 15:15:00+05:30')
on conflict (id) do update set
    user_id = excluded.user_id,
    event_id = excluded.event_id,
    "createdAt" = excluded."createdAt";

commit;
