-- Aggregated monthly GLOCO reports are stored separately from PID encounter records.
create table if not exists public.gloco_monthly_report_imports (
  id uuid primary key default gen_random_uuid(),
  report_month date not null check (report_month = date_trunc('month', report_month)::date),
  source_filename text not null check (char_length(source_filename) between 1 and 180),
  report_data jsonb not null check (jsonb_typeof(report_data) = 'object'),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now()
);

create index if not exists gloco_monthly_report_imports_month_idx
  on public.gloco_monthly_report_imports (report_month desc, imported_at desc);

alter table public.gloco_monthly_report_imports enable row level security;

create policy "Management can read monthly GLOCO reports"
  on public.gloco_monthly_report_imports
  for select to authenticated
  using (public.current_user_role() in ('owner', 'admin', 'finance'));

create policy "Owner and Finance can add monthly GLOCO reports"
  on public.gloco_monthly_report_imports
  for insert to authenticated
  with check (
    public.current_user_role() in ('owner', 'finance')
    and imported_by = (select auth.uid())
  );

revoke all on public.gloco_monthly_report_imports from public, anon;
revoke update, delete on public.gloco_monthly_report_imports from authenticated;
grant select, insert on public.gloco_monthly_report_imports to authenticated;
