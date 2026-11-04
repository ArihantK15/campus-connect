begin;

-- Preserve the timestamped seeded registrations and remove the duplicate rows
-- that were created during capacity/duplicate checks.
with ranked_registrations as (
    select id,
           row_number() over (
               partition by event_id, user_id
               order by "createdAt" nulls last, id
           ) as duplicate_number
    from public.registrations
)
delete from public.registrations as registration
using ranked_registrations as ranked
where registration.id = ranked.id
  and ranked.duplicate_number > 1;

create unique index if not exists registrations_event_user_unique
    on public.registrations (event_id, user_id);
create index if not exists registrations_user_id_idx
    on public.registrations (user_id);

alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;

revoke all on table public.users, public.events, public.registrations
    from anon, authenticated;
grant select on table public.events to anon, authenticated;
grant all on table public.users, public.events, public.registrations
    to service_role;

drop policy if exists "Events are publicly readable" on public.events;
create policy "Events are publicly readable"
    on public.events for select
    to anon, authenticated
    using (true);

create or replace function public.register_for_event(
    p_event_id uuid,
    p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    event_capacity integer;
    registration_count bigint;
    new_registration public.registrations;
begin
    select event.capacity
      into event_capacity
      from public.events as event
     where event.id = p_event_id
     for update;

    if not found then
        return jsonb_build_object('status', 'event_not_found');
    end if;

    if exists (
        select 1
          from public.registrations as registration
         where registration.event_id = p_event_id
           and registration.user_id = p_user_id
    ) then
        return jsonb_build_object('status', 'already_registered');
    end if;

    select count(*)
      into registration_count
      from public.registrations as registration
     where registration.event_id = p_event_id;

    if event_capacity is not null and registration_count >= event_capacity then
        return jsonb_build_object('status', 'event_full');
    end if;

    insert into public.registrations (event_id, user_id)
    values (p_event_id, p_user_id)
    returning * into new_registration;

    return jsonb_build_object(
        'status', 'created',
        'registration', to_jsonb(new_registration)
    );
exception
    when unique_violation then
        return jsonb_build_object('status', 'already_registered');
end;
$$;

revoke all on function public.register_for_event(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.register_for_event(uuid, uuid)
    to service_role;

commit;
