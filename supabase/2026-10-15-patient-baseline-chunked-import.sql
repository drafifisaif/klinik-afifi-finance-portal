-- Stage large historical patient baselines in bounded transactions.
-- The currently active baseline is switched only after every chunk is verified.

create or replace function public.start_patient_baseline_import(
  p_patient_count integer,
  p_first_date date,
  p_last_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  new_batch_id uuid;
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import the historical patient list.';
  end if;
  if p_patient_count is null or p_patient_count < 1 or p_patient_count > 100000
    or p_first_date is null or p_last_date is null or p_first_date > p_last_date then
    raise exception using errcode = '22023', message = 'Invalid historical baseline metadata.';
  end if;

  insert into public.patient_baseline_batches (
    patient_count, last_encounter_from, last_encounter_to, imported_by, is_active
  ) values (p_patient_count, p_first_date, p_last_date, actor_id, false)
  returning id into new_batch_id;
  return new_batch_id;
end;
$$;

create or replace function public.append_patient_baseline_import(
  p_batch_id uuid,
  p_patients jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  inserted_count integer;
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import the historical patient list.';
  end if;
  if not exists (
    select 1 from public.patient_baseline_batches b
    where b.id = p_batch_id and b.imported_by = actor_id and not b.is_active
  ) then
    raise exception using errcode = '42501', message = 'Patient baseline import batch is not available.';
  end if;
  if jsonb_typeof(p_patients) <> 'array'
    or jsonb_array_length(p_patients) < 1
    or jsonb_array_length(p_patients) > 2500
    or exists (
      select 1 from jsonb_to_recordset(p_patients) as x(patient_key text, last_encounter_date date)
      where x.patient_key is null or x.patient_key !~ '^[0-9a-f]{64}$' or x.last_encounter_date is null
    ) then
    raise exception using errcode = '22023', message = 'Historical patient batch contains invalid records.';
  end if;

  insert into public.patient_historical_baseline (patient_key, baseline_batch_id, last_encounter_date)
  select x.patient_key, p_batch_id, x.last_encounter_date
  from jsonb_to_recordset(p_patients) as x(patient_key text, last_encounter_date date)
  on conflict (baseline_batch_id, patient_key) do update
    set last_encounter_date = greatest(public.patient_historical_baseline.last_encounter_date, excluded.last_encounter_date);
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.finalize_patient_baseline_import(p_batch_id uuid)
returns table (baseline_batch_id uuid, patient_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  expected_count integer;
  actual_count integer;
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import the historical patient list.';
  end if;
  perform pg_advisory_xact_lock(hashtext('patient-historical-baseline'));

  select b.patient_count into expected_count
  from public.patient_baseline_batches b
  where b.id = p_batch_id and b.imported_by = actor_id and not b.is_active
  for update;
  if expected_count is null then
    raise exception using errcode = '42501', message = 'Patient baseline import batch is not available.';
  end if;

  select count(*)::integer into actual_count
  from public.patient_historical_baseline h where h.baseline_batch_id = p_batch_id;
  if actual_count <> expected_count then
    raise exception using errcode = '22023', message = 'Patient baseline import batch is incomplete.';
  end if;

  update public.patient_baseline_batches set is_active = false where is_active;
  update public.patient_baseline_batches set is_active = true where id = p_batch_id;

  update public.patient_period_summaries s
  set new_patient_count = counts.new_patient_count,
      updated_at = now()
  from (
    select s2.id,
      count(distinct e.patient_key) filter (
        where r.first_seen_date between s2.period_start and s2.period_end
          and r.first_seen_branch_id = s2.branch_id
          and not exists (
            select 1 from public.patient_historical_baseline h
            join public.patient_baseline_batches b on b.id = h.baseline_batch_id and b.is_active
            where h.patient_key = e.patient_key
          )
      )::integer as new_patient_count
    from public.patient_period_summaries s2
    left join public.patient_encounters e
      on e.branch_id = s2.branch_id and e.encounter_date between s2.period_start and s2.period_end
    left join public.patient_registry r on r.patient_key = e.patient_key
    group by s2.id
  ) counts
  where s.id = counts.id
    and s.new_patient_count is distinct from counts.new_patient_count;

  baseline_batch_id := p_batch_id;
  patient_count := actual_count;
  return next;
end;
$$;

create or replace function public.discard_patient_baseline_import(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import the historical patient list.';
  end if;
  delete from public.patient_baseline_batches
  where id = p_batch_id and imported_by = actor_id and not is_active;
end;
$$;

revoke all on function public.start_patient_baseline_import(integer, date, date) from public;
revoke all on function public.append_patient_baseline_import(uuid, jsonb) from public;
revoke all on function public.finalize_patient_baseline_import(uuid) from public;
revoke all on function public.discard_patient_baseline_import(uuid) from public;
grant execute on function public.start_patient_baseline_import(integer, date, date) to authenticated;
grant execute on function public.append_patient_baseline_import(uuid, jsonb) to authenticated;
grant execute on function public.finalize_patient_baseline_import(uuid) to authenticated;
grant execute on function public.discard_patient_baseline_import(uuid) to authenticated;
