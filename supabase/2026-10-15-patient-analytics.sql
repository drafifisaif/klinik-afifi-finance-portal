-- Patient analytics stores keyed identifiers only; names and contact data are not imported.
-- Run once in Supabase SQL Editor after reviewing the permissions below.

create table if not exists public.patient_registry (
  patient_key text primary key,
  first_seen_date date not null,
  first_seen_branch_id uuid not null references public.branches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_import_batches (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  period_no smallint not null check (period_no between 1 and 4),
  period_start date not null,
  period_end date not null,
  source_filename text not null,
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  new_patient_count integer not null default 0 check (new_patient_count >= 0),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint patient_import_batch_period_dates check (
    period_month = date_trunc('month', period_month)::date
    and period_start <= period_end
    and period_start = case period_no
      when 1 then period_month
      when 2 then period_month + 7
      when 3 then period_month + 14
      else period_month + 21
    end
    and period_end = case period_no
      when 1 then period_month + 6
      when 2 then period_month + 13
      when 3 then period_month + 20
      else (period_month + interval '1 month' - interval '1 day')::date
    end
  )
);

create table if not exists public.patient_encounters (
  id uuid primary key default gen_random_uuid(),
  patient_key text not null references public.patient_registry(patient_key) on delete restrict,
  encounter_key text not null unique,
  encounter_date date not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  import_batch_id uuid not null references public.patient_import_batches(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists patient_encounters_date_branch_idx
  on public.patient_encounters (encounter_date, branch_id);
create index if not exists patient_encounters_patient_date_idx
  on public.patient_encounters (patient_key, encounter_date);

create table if not exists public.patient_period_summaries (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  period_no smallint not null check (period_no between 1 and 4),
  period_start date not null,
  period_end date not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  visit_count integer not null default 0 check (visit_count >= 0),
  unique_patient_count integer not null default 0 check (unique_patient_count >= 0),
  new_patient_count integer not null default 0 check (new_patient_count >= 0),
  is_complete boolean not null default false,
  last_imported_by uuid references public.profiles(id) on delete set null,
  last_imported_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (period_month, period_no, branch_id),
  constraint patient_summary_period_dates check (
    period_month = date_trunc('month', period_month)::date
    and period_start = case period_no
      when 1 then period_month
      when 2 then period_month + 7
      when 3 then period_month + 14
      else period_month + 21
    end
    and period_end = case period_no
      when 1 then period_month + 6
      when 2 then period_month + 13
      when 3 then period_month + 20
      else (period_month + interval '1 month' - interval '1 day')::date
    end
  )
);

alter table public.patient_registry enable row level security;
alter table public.patient_import_batches enable row level security;
alter table public.patient_encounters enable row level security;
alter table public.patient_period_summaries enable row level security;

drop policy if exists "Finance can manage patient registry" on public.patient_registry;
create policy "Finance can manage patient registry"
on public.patient_registry for all to authenticated
using (public.current_user_role() in ('owner', 'finance'))
with check (public.current_user_role() in ('owner', 'finance'));

drop policy if exists "Finance can manage patient imports" on public.patient_import_batches;
create policy "Finance can manage patient imports"
on public.patient_import_batches for all to authenticated
using (public.current_user_role() in ('owner', 'finance'))
with check (public.current_user_role() in ('owner', 'finance'));

drop policy if exists "Finance can manage patient encounters" on public.patient_encounters;
create policy "Finance can manage patient encounters"
on public.patient_encounters for all to authenticated
using (public.current_user_role() in ('owner', 'finance'))
with check (public.current_user_role() in ('owner', 'finance'));

drop policy if exists "Authorized roles can read patient summaries" on public.patient_period_summaries;
create policy "Authorized roles can read patient summaries"
on public.patient_period_summaries for select to authenticated
using (
  public.current_user_role() in ('owner', 'admin', 'finance')
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Finance can manage patient summaries" on public.patient_period_summaries;
create policy "Finance can manage patient summaries"
on public.patient_period_summaries for all to authenticated
using (public.current_user_role() in ('owner', 'finance'))
with check (public.current_user_role() in ('owner', 'finance'));

grant select, insert, update, delete on public.patient_registry to authenticated;
grant select, insert, update, delete on public.patient_import_batches to authenticated;
grant select, insert, update, delete on public.patient_encounters to authenticated;
grant select, insert, update, delete on public.patient_period_summaries to authenticated;

create or replace function public.import_patient_encounters(
  p_period_month date,
  p_period_no smallint,
  p_period_start date,
  p_period_end date,
  p_source_filename text,
  p_encounters jsonb
)
returns table (batch_id uuid, inserted_count integer, duplicate_count integer, new_patient_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  new_batch_id uuid;
  row_count integer;
  inserted_rows integer;
  newly_seen integer;
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import patient reports.';
  end if;
  if p_period_month <> date_trunc('month', p_period_month)::date
    or p_period_no not between 1 and 4
    or p_period_start <> case p_period_no
      when 1 then p_period_month
      when 2 then p_period_month + 7
      when 3 then p_period_month + 14
      else p_period_month + 21
    end
    or p_period_end <> case p_period_no
      when 1 then p_period_month + 6
      when 2 then p_period_month + 13
      when 3 then p_period_month + 20
      else (p_period_month + interval '1 month' - interval '1 day')::date
    end then
    raise exception using errcode = '22023', message = 'Invalid patient reporting period.';
  end if;
  if jsonb_typeof(p_encounters) <> 'array' or jsonb_array_length(p_encounters) = 0 then
    raise exception using errcode = '22023', message = 'No patient encounters supplied.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_encounters) as x(patient_key text, encounter_key text, encounter_date date, branch_id uuid)
    left join public.branches b on b.id = x.branch_id and b.is_active
    where x.patient_key !~ '^[0-9a-f]{64}$'
      or x.encounter_key !~ '^[0-9a-f]{64}$'
      or x.encounter_date < p_period_start
      or x.encounter_date > p_period_end
      or b.id is null
  ) then
    raise exception using errcode = '22023', message = 'Patient report contains invalid or out-of-period rows.';
  end if;

  insert into public.patient_import_batches (
    period_month, period_no, period_start, period_end, source_filename,
    rows_seen, rows_imported, duplicate_rows, new_patient_count, imported_by
  ) values (
    p_period_month, p_period_no, p_period_start, p_period_end,
    left(regexp_replace(coalesce(p_source_filename, 'gloco-report.xlsx'), '[^A-Za-z0-9._ -]', '', 'g'), 180),
    jsonb_array_length(p_encounters), 0, 0, 0, actor_id
  ) returning id into new_batch_id;

  insert into public.patient_registry (patient_key, first_seen_date, first_seen_branch_id)
  select distinct on (x.patient_key) x.patient_key, x.encounter_date, x.branch_id
  from jsonb_to_recordset(p_encounters) as x(patient_key text, encounter_key text, encounter_date date, branch_id uuid)
  order by x.patient_key, x.encounter_date, x.branch_id
  on conflict (patient_key) do update
  set first_seen_date = excluded.first_seen_date,
      first_seen_branch_id = excluded.first_seen_branch_id,
      updated_at = now()
  where excluded.first_seen_date < public.patient_registry.first_seen_date;

  select count(*) into row_count from jsonb_to_recordset(p_encounters)
    as x(patient_key text, encounter_key text, encounter_date date, branch_id uuid);

  with inserted as (
    insert into public.patient_encounters (patient_key, encounter_key, encounter_date, branch_id, import_batch_id)
    select distinct x.patient_key, x.encounter_key, x.encounter_date, x.branch_id, new_batch_id
    from jsonb_to_recordset(p_encounters) as x(patient_key text, encounter_key text, encounter_date date, branch_id uuid)
    on conflict (encounter_key) do nothing
    returning encounter_key
  ) select count(*) into inserted_rows from inserted;

  select count(distinct e.patient_key)::integer into newly_seen
  from public.patient_encounters e
  join public.patient_registry r on r.patient_key = e.patient_key
  where e.encounter_date between p_period_start and p_period_end
    and r.first_seen_date between p_period_start and p_period_end;

  update public.patient_import_batches
  set rows_imported = inserted_rows,
      duplicate_rows = greatest(row_count - inserted_rows, 0),
      new_patient_count = newly_seen
  where id = new_batch_id;

  insert into public.patient_period_summaries (
    period_month, period_no, period_start, period_end, branch_id,
    visit_count, unique_patient_count, new_patient_count, is_complete,
    last_imported_by, last_imported_at, updated_at
  )
  select p_period_month, p_period_no, p_period_start, p_period_end, b.id,
    count(e.id)::integer,
    count(distinct e.patient_key)::integer,
    count(distinct e.patient_key) filter (
      where r.first_seen_date between p_period_start and p_period_end
    )::integer,
    true, actor_id, now(), now()
  from public.branches b
  left join public.patient_encounters e
    on e.branch_id = b.id and e.encounter_date between p_period_start and p_period_end
  left join public.patient_registry r on r.patient_key = e.patient_key
  where b.is_active
  group by b.id
  on conflict (period_month, period_no, branch_id) do update
  set visit_count = excluded.visit_count,
      unique_patient_count = excluded.unique_patient_count,
      new_patient_count = excluded.new_patient_count,
      is_complete = true,
      last_imported_by = excluded.last_imported_by,
      last_imported_at = excluded.last_imported_at,
      updated_at = now();

  -- Recompute historical first-seen counts when earlier periods are imported later.
  update public.patient_period_summaries s
  set new_patient_count = counts.new_patient_count,
      updated_at = now()
  from (
    select s2.id,
      count(distinct e.patient_key) filter (
        where r.first_seen_date between s2.period_start and s2.period_end
      )::integer as new_patient_count
    from public.patient_period_summaries s2
    left join public.patient_encounters e
      on e.branch_id = s2.branch_id
      and e.encounter_date between s2.period_start and s2.period_end
    left join public.patient_registry r on r.patient_key = e.patient_key
    group by s2.id
  ) counts
  where s.id = counts.id
    and s.new_patient_count is distinct from counts.new_patient_count;

  batch_id := new_batch_id;
  inserted_count := inserted_rows;
  duplicate_count := greatest(row_count - inserted_rows, 0);
  new_patient_count := newly_seen;
  return next;
end;
$$;

revoke all on function public.import_patient_encounters(date, smallint, date, date, text, jsonb) from public;
grant execute on function public.import_patient_encounters(date, smallint, date, date, text, jsonb) to authenticated;
