-- Import one complete GLOCO month atomically, keeping the existing four-week model.
create or replace function public.import_patient_encounters_month(
  p_period_month date,
  p_source_filename text,
  p_encounters jsonb
)
returns table (
  period_no smallint,
  inserted_count integer,
  duplicate_count integer,
  new_patient_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  month_end date;
  week_no smallint;
  week_start date;
  week_end date;
  week_encounters jsonb;
  empty_batch_id uuid;
  imported record;
begin
  if actor_id is null or public.current_user_role() not in ('owner', 'finance') then
    raise exception using errcode = '42501', message = 'Only Owner or Finance can import patient reports.';
  end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date
    or p_encounters is null or jsonb_typeof(p_encounters) <> 'array'
    or jsonb_array_length(p_encounters) = 0 or jsonb_array_length(p_encounters) > 50000 then
    raise exception using errcode = '22023', message = 'A valid month and 1 to 50,000 patient encounters are required.';
  end if;

  month_end := (p_period_month + interval '1 month' - interval '1 day')::date;
  if exists (
    select 1
    from jsonb_to_recordset(p_encounters) as x(patient_key text, encounter_key text, encounter_date date, branch_id uuid)
    left join public.branches b on b.id = x.branch_id and b.is_active
    where x.patient_key is null or x.patient_key !~ '^[0-9a-f]{64}$'
      or x.encounter_key is null or x.encounter_key !~ '^[0-9a-f]{64}$'
      or x.encounter_date is null or x.encounter_date < p_period_month or x.encounter_date > month_end
      or b.id is null
  ) then
    raise exception using errcode = '22023', message = 'Patient report contains invalid or out-of-month rows.';
  end if;

  perform pg_advisory_xact_lock(hashtext('patient-month-import'), hashtext(p_period_month::text));
  for week_no in 1..4 loop
    week_start := p_period_month + ((week_no - 1) * 7);
    week_end := case when week_no = 4 then month_end else week_start + 6 end;
    select coalesce(jsonb_agg(item.value), '[]'::jsonb)
    into week_encounters
    from jsonb_array_elements(p_encounters) as item(value)
    where (item.value->>'encounter_date')::date between week_start and week_end;

    if jsonb_array_length(week_encounters) > 0 then
      select * into imported
      from public.import_patient_encounters(
        p_period_month, week_no, week_start, week_end, p_source_filename, week_encounters
      );
      period_no := week_no;
      inserted_count := imported.inserted_count;
      duplicate_count := imported.duplicate_count;
      new_patient_count := imported.new_patient_count;
    else
      insert into public.patient_import_batches (
        period_month, period_no, period_start, period_end, source_filename,
        rows_seen, rows_imported, duplicate_rows, new_patient_count, imported_by
      ) values (
        p_period_month, week_no, week_start, week_end,
        left(regexp_replace(coalesce(p_source_filename, 'gloco-report.xlsx'), '[^A-Za-z0-9._ -]', '', 'g'), 180),
        0, 0, 0, 0, actor_id
      ) returning id into empty_batch_id;

      insert into public.patient_period_summaries (
        period_month, period_no, period_start, period_end, branch_id,
        visit_count, unique_patient_count, new_patient_count, is_complete,
        last_imported_by, last_imported_at, updated_at
      )
      select p_period_month, week_no, week_start, week_end, b.id,
        count(e.id)::integer,
        count(distinct e.patient_key)::integer,
        count(distinct e.patient_key) filter (
          where r.first_seen_date between week_start and week_end
            and r.first_seen_branch_id = b.id
            and not exists (
              select 1 from public.patient_historical_baseline h
              join public.patient_baseline_batches hb on hb.id = h.baseline_batch_id and hb.is_active
              where h.patient_key = e.patient_key
            )
        )::integer,
        true, actor_id, now(), now()
      from public.branches b
      left join public.patient_encounters e
        on e.branch_id = b.id and e.encounter_date between week_start and week_end
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

      period_no := week_no;
      inserted_count := 0;
      duplicate_count := 0;
      new_patient_count := 0;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.import_patient_encounters_month(date, text, jsonb) from public, anon;
grant execute on function public.import_patient_encounters_month(date, text, jsonb) to authenticated;
