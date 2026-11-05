begin;

-- Add admin role to users table
-- The role column already exists as text, we just need to ensure 'admin' is valid
-- and update any constraints or check constraints if they exist

-- Normalize legacy values, then replace the named constraint so deployments
-- with an older attendee/organizer-only version can accept admin as well.
update public.users
   set role = 'attendee'
 where role is null or role not in ('attendee', 'organizer', 'admin');

alter table public.users
    drop constraint if exists users_role_check;
alter table public.users
    add constraint users_role_check
    check (role is not null and role in ('attendee', 'organizer', 'admin'));

-- Events: publicly readable
drop policy if exists "Events are publicly readable" on public.events;
create policy "Events are publicly readable"
    on public.events for select
    to anon, authenticated
    using (true);

-- Users: server-only (no direct client access)
drop policy if exists "Users are server-only" on public.users;
create policy "Users are server-only"
    on public.users for all
    to anon, authenticated
    using (false)
    with check (false);

-- Registrations: server-only (no direct client access)
drop policy if exists "Registrations are server-only" on public.registrations;
create policy "Registrations are server-only"
    on public.registrations for all
    to anon, authenticated
    using (false)
    with check (false);

commit;
