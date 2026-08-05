-- Daily Sales replacement-after-void hardening.
-- Run this in Supabase if branch/date re-key after void is blocked by a unique violation.
-- The app uses public.daily_sales.sale_date as the transaction date column.

do $$
declare
  constraint_record record;
  index_record record;
begin
  -- Drop only non-partial unique constraints that enforce exactly one row per branch/date.
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

  -- Drop standalone non-partial unique indexes on exactly branch_id + sale_date.
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
