-- Store only aggregate insights from encounter exports; raw PIDs are never persisted here.
create table if not exists public.gloco_encounter_analysis_imports (
  id uuid primary key default gen_random_uuid(),
  report_month date not null check (report_month = date_trunc('month', report_month)::date),
  source_filename text not null check (char_length(source_filename) between 1 and 180),
  report_data jsonb not null check (jsonb_typeof(report_data) = 'object'),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now()
);

create index if not exists gloco_encounter_analysis_month_idx
  on public.gloco_encounter_analysis_imports (report_month desc, imported_at desc);

alter table public.gloco_encounter_analysis_imports enable row level security;

drop policy if exists "Management can read encounter analysis"
  on public.gloco_encounter_analysis_imports;
create policy "Management can read encounter analysis"
  on public.gloco_encounter_analysis_imports
  for select to authenticated
  using (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Owner and Finance can add encounter analysis"
  on public.gloco_encounter_analysis_imports;
create policy "Owner and Finance can add encounter analysis"
  on public.gloco_encounter_analysis_imports
  for insert to authenticated
  with check (
    public.current_user_role() in ('owner', 'finance')
    and imported_by = (select auth.uid())
  );

revoke all on public.gloco_encounter_analysis_imports from public, anon;
revoke update, delete on public.gloco_encounter_analysis_imports from authenticated;
grant select, insert on public.gloco_encounter_analysis_imports to authenticated;
