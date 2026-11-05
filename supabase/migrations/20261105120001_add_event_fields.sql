begin;

-- Add new columns to events table for richer event data
alter table public.events
    add column if not exists description text,
    add column if not exists location text,
    add column if not exists price numeric(10,2) default 0,
    add column if not exists image_url text,
    add column if not exists created_at timestamptz default now();

-- Add check constraint for price
do $$
begin
    if not exists (
        select 1
          from pg_constraint constraint_row
          join pg_class table_row on table_row.oid = constraint_row.conrelid
          join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
         where schema_row.nspname = 'public'
           and table_row.relname = 'events'
           and constraint_row.conname = 'events_price_check'
    ) then
        alter table public.events
        add constraint events_price_check
        check (price >= 0);
    end if;
end $$;

-- Add check constraint for capacity
do $$
begin
    if not exists (
        select 1
          from pg_constraint constraint_row
          join pg_class table_row on table_row.oid = constraint_row.conrelid
          join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
         where schema_row.nspname = 'public'
           and table_row.relname = 'events'
           and constraint_row.conname = 'events_capacity_check'
    ) then
        alter table public.events
        add constraint events_capacity_check
        check (capacity is null or capacity >= 0);
    end if;
end $$;

-- Update existing events with default values
update public.events
set price = 0
where price is null;

update public.events
set created_at = now()
where created_at is null;

-- Create index for organizer queries
create index if not exists events_organiser_id_idx
    on public.events (organiser_id);

-- Create index for timestamp queries
create index if not exists events_timestamp_idx
    on public.events ("timestamp");

commit;
