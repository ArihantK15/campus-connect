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

-- Update RLS policies to allow admin role access
-- Drop existing policies and recreate with admin access

-- Events: admins can do everything
drop policy if exists "Events are publicly readable" on public.events;
create policy "Events are publicly readable"
    on public.events for select
    to anon, authenticated
    using (true);

drop policy if exists "Admins can manage events" on public.events;
create policy "Admins can manage events"
    on public.events for all
    to authenticated
    using (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    );

-- Users: admins can view all users
drop policy if exists "Users are server-only" on public.users;
create policy "Users are server-only"
    on public.users for all
    to anon, authenticated
    using (false)
    with check (false);

drop policy if exists "Admins can view all users" on public.users;
create policy "Admins can view all users"
    on public.users for select
    to authenticated
    using (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    );

drop policy if exists "Admins can manage users" on public.users;
create policy "Admins can manage users"
    on public.users for insert, update, delete
    to authenticated
    using (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    );

-- Registrations: admins can view all registrations
drop policy if exists "Registrations are server-only" on public.registrations;
create policy "Registrations are server-only"
    on public.registrations for all
    to anon, authenticated
    using (false)
    with check (false);

drop policy if exists "Admins can view all registrations" on public.registrations;
create policy "Admins can view all registrations"
    on public.registrations for select
    to authenticated
    using (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    );

drop policy if exists "Admins can manage registrations" on public.registrations;
create policy "Admins can manage registrations"
    on public.registrations for insert, update, delete
    to authenticated
    using (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.users
            where auth_user_id = auth.uid()
            and role = 'admin'
        )
    );

commit;