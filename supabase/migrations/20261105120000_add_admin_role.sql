begin;

-- Add admin role to users table
-- The role column already exists as text, we just need to ensure 'admin' is valid
-- and update any constraints or check constraints if they exist

-- First, let's check if there's a check constraint on role
-- If not, we'll add one to validate roles

-- Add check constraint for valid roles (if not exists)
do $$
begin
    if not exists (
        select 1 from information_schema.check_constraints
        where constraint_name = 'users_role_check'
    ) then
        -- First, fix any invalid roles in existing data
        update public.users
        set role = 'attendee'
        where role not in ('attendee', 'organizer', 'admin');
        
        alter table public.users
        add constraint users_role_check
        check (role in ('attendee', 'organizer', 'admin'));
    end if;
end $$;

-- Create admin user if not exists (for demo purposes)
-- This will be linked to a Supabase Auth user via the trigger
insert into public.users (id, email, role)
values
    ('00000000-0000-4000-8000-000000000000', 'admin@campusconnect.test', 'admin')
on conflict (id) do update set
    email = excluded.email,
    role = excluded.role;

-- Grant admin access to all tables via service_role (already done in previous migrations)
-- But we need to ensure admins can access data through RLS policies

-- RLS policies: service role (used by admin APIs) bypasses RLS entirely
-- These policies only apply to anon/authenticated roles (direct client access)
-- Admin APIs use service role client, so they don't need special policies

-- Events: publicly readable
drop policy if exists "Events are publicly readable" on public.events;
create policy "Events are publicly readable"
    on public.events for select
    to anon, authenticated
    using (true);

-- Organizers can manage their own events
drop policy if exists "Organizers can insert own events" on public.events;
create policy "Organizers can insert own events"
    on public.events for insert
    to authenticated
    with check (
        organiser_id in (
            select id from public.users where auth_user_id = auth.uid()
        )
    );

drop policy if exists "Organizers can update own events" on public.events;
create policy "Organizers can update own events"
    on public.events for update
    to authenticated
    using (
        organiser_id in (
            select id from public.users where auth_user_id = auth.uid()
        )
    )
    with check (
        organiser_id in (
            select id from public.users where auth_user_id = auth.uid()
        )
    );

drop policy if exists "Organizers can delete own events" on public.events;
create policy "Organizers can delete own events"
    on public.events for delete
    to authenticated
    using (
        organiser_id in (
            select id from public.users where auth_user_id = auth.uid()
        )
    );

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