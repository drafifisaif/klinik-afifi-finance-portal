-- Monthly controlled opening balances for branch cash and petty cash.
-- Run this once in Supabase SQL Editor before September 2026 controlled closing starts.
-- Supabase Dashboard -> SQL Editor -> New query -> paste this SQL -> Run.

drop policy if exists "Owner can manage opening balances" on public.opening_balances;
drop policy if exists "Owner and finance can manage opening balances" on public.opening_balances;
create policy "Owner and finance can manage opening balances"
on public.opening_balances for all
to authenticated
using (public.current_user_role() in ('owner', 'finance'))
with check (public.current_user_role() in ('owner', 'finance'));

create table if not exists public.monthly_opening_balances (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  balance_month date not null,
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  opening_petty_cash numeric(12,2) not null default 0 check (opening_petty_cash >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint monthly_opening_balances_month_start_check check (balance_month = date_trunc('month', balance_month)::date),
  constraint monthly_opening_balances_start_month_check check (balance_month >= date '2026-09-01')
);

create unique index if not exists monthly_opening_balances_one_per_branch_month
on public.monthly_opening_balances (branch_id, balance_month);

drop trigger if exists set_monthly_opening_balances_updated_at on public.monthly_opening_balances;
create trigger set_monthly_opening_balances_updated_at before update on public.monthly_opening_balances
for each row execute function public.set_updated_at();

alter table public.monthly_opening_balances enable row level security;

drop policy if exists "Opening balances can be viewed by branch access" on public.monthly_opening_balances;
create policy "Opening balances can be viewed by branch access"
on public.monthly_opening_balances for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Owner and finance can create monthly opening balances" on public.monthly_opening_balances;
create policy "Owner and finance can create monthly opening balances"
on public.monthly_opening_balances for insert
to authenticated
with check (
  public.current_user_role() in ('owner', 'finance')
  and public.can_access_branch(branch_id)
  and coalesce(created_by, auth.uid()) = auth.uid()
  and coalesce(updated_by, auth.uid()) = auth.uid()
);

drop policy if exists "Owner and finance can update monthly opening balances" on public.monthly_opening_balances;
create policy "Owner and finance can update monthly opening balances"
on public.monthly_opening_balances for update
to authenticated
using (
  public.current_user_role() in ('owner', 'finance')
  and public.can_access_branch(branch_id)
)
with check (
  public.current_user_role() in ('owner', 'finance')
  and public.can_access_branch(branch_id)
  and coalesce(updated_by, auth.uid()) = auth.uid()
);
