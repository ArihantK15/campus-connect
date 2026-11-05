begin;

-- Email-based account linking is only safe when each app profile has one
-- case-insensitive email match. Resolve any existing duplicates first.
do $$
begin
    if exists (
        select lower(email)
          from public.users
         group by lower(email)
        having count(*) > 1
    ) then
        raise exception 'Resolve case-insensitive duplicate public.users emails before applying this migration.';
    end if;
end;
$$;

create unique index if not exists users_email_lower_unique
    on public.users (lower(email));

commit;
