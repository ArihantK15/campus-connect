begin;

-- RLS already denies access in the absence of a policy. These explicit deny
-- policies document that users and registrations are server-only tables.
drop policy if exists "Users are server-only" on public.users;
create policy "Users are server-only"
    on public.users for all
    to anon, authenticated
    using (false)
    with check (false);

drop policy if exists "Registrations are server-only" on public.registrations;
create policy "Registrations are server-only"
    on public.registrations for all
    to anon, authenticated
    using (false)
    with check (false);

commit;
