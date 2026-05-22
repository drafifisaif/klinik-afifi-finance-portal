-- Phase 12: supplier and panel company management for finance role without hard delete.
-- Run after supabase/phase11-expense-edit-void.sql.

alter table public.suppliers
  add column if not exists notes text;

alter table public.panel_companies
  add column if not exists address text,
  add column if not exists notes text;

drop policy if exists "Finance can manage suppliers" on public.suppliers;
drop policy if exists "Finance can insert suppliers" on public.suppliers;
create policy "Finance can insert suppliers"
on public.suppliers for insert
to authenticated
with check (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Finance can update suppliers" on public.suppliers;
create policy "Finance can update suppliers"
on public.suppliers for update
to authenticated
using (public.current_user_role() in ('owner', 'admin', 'finance'))
with check (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Finance can manage panel companies" on public.panel_companies;
drop policy if exists "Finance can insert panel companies" on public.panel_companies;
create policy "Finance can insert panel companies"
on public.panel_companies for insert
to authenticated
with check (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Finance can update panel companies" on public.panel_companies;
create policy "Finance can update panel companies"
on public.panel_companies for update
to authenticated
using (public.current_user_role() in ('owner', 'admin', 'finance'))
with check (public.current_user_role() in ('owner', 'admin', 'finance'));
