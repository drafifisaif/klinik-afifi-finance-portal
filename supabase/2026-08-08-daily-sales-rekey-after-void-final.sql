-- Daily Sales void/re-key final hardening.
-- Business rule: voided rows are audit history and must not block a new active
-- Daily Sales record for the same branch/date.
-- Run this once in Supabase SQL Editor if re-keying after void is still blocked.

alter table public.daily_sales
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

do $$
declare
  constraint_record record;
  index_record record;
begin
  -- Remove old constraints that enforce exactly one row for branch/date,
  -- because that also blocks replacement rows after void.
  for constraint_record in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'daily_sales'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by keys.ordinality)
        from unnest(con.conkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute att on att.attrelid = rel.oid and att.attnum = keys.attnum
      ) = array['branch_id', 'sale_date']
  loop
    execute format('alter table public.daily_sales drop constraint %I', constraint_record.conname);
  end loop;

  -- Remove standalone non-partial unique indexes that enforce the same old rule.
  for index_record in
    select idx.indexrelid::regclass::text as index_name
    from pg_index idx
    join pg_class rel on rel.oid = idx.indrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'daily_sales'
      and idx.indisunique
      and idx.indpred is null
      and (
        select array_agg(att.attname::text order by keys.ordinality)
        from unnest(string_to_array(idx.indkey::text, ' ')::int2[]) with ordinality as keys(attnum, ordinality)
        join pg_attribute att on att.attrelid = rel.oid and att.attnum = keys.attnum
      ) = array['branch_id', 'sale_date']
  loop
    execute format('drop index if exists %s', index_record.index_name);
  end loop;
end $$;

create unique index if not exists daily_sales_one_active_per_branch_date
on public.daily_sales (branch_id, sale_date)
where coalesce(is_void, false) = false;
