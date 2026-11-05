begin;

alter table public.users
    add column auth_user_id uuid
        references auth.users (id)
        on delete set null;

create unique index users_auth_user_id_unique
    on public.users (auth_user_id)
    where auth_user_id is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.link_confirmed_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    matching_user_ids uuid[];
begin
    if new.email is null or new.email_confirmed_at is null then
        return new;
    end if;

    update public.users
       set email = lower(new.email)
     where auth_user_id = new.id;
    if found then
        return new;
    end if;

    select array_agg(candidate.id order by candidate.id)
      into matching_user_ids
      from (
          select app_user.id
            from public.users as app_user
           where lower(app_user.email) = lower(new.email)
             and app_user.auth_user_id is null
             and app_user.id <> '00000000-0000-4000-8000-000000000000'::uuid
           order by app_user.id
           limit 2
      ) as candidate;

    if cardinality(matching_user_ids) > 1 then
        raise exception 'The account email matches multiple application users.';
    elsif cardinality(matching_user_ids) = 1 then
        update public.users
           set auth_user_id = new.id
         where id = matching_user_ids[1]
           and auth_user_id is null;
        if not found then
            raise exception 'The application user is already linked to another account.';
        end if;
    else
        insert into public.users (id, email, role, auth_user_id)
        values (gen_random_uuid(), lower(new.email), 'attendee', new.id);
    end if;

    return new;
end;
$$;

revoke all on function private.link_confirmed_auth_user()
    from public, anon, authenticated, service_role;

create trigger on_auth_user_confirmed
    after insert or update of email_confirmed_at, email
    on auth.users
    for each row
    execute function private.link_confirmed_auth_user();

commit;
