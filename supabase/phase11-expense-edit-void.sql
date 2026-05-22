-- Phase 11: expense edit and void markers.
-- Run after supabase/phase10-opening-balance-verification-import.sql.

alter table public.expenses
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.expenses
  drop constraint if exists expenses_void_reason_check,
  add constraint expenses_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

create index if not exists expenses_active_branch_date_idx
on public.expenses (branch_id, expense_date desc)
where not is_void;

drop policy if exists "Finance can update expenses" on public.expenses;
create policy "Finance can update expenses"
on public.expenses for update
to authenticated
using (
  public.can_access_branch(branch_id)
  and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic')
  and (public.current_user_role() = 'owner' or not is_void)
)
with check (
  public.can_access_branch(branch_id)
  and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic')
);

create or replace view public.v_branch_monthly_finance
with (security_invoker = on) as
with sales_monthly as (
  select
    branch_id,
    date_trunc('month', sale_date)::date as month,
    sum(total_amount) as sales_total,
    sum(panel_amount) as panel_sales_total
  from public.daily_sales
  where not is_void
  group by branch_id, date_trunc('month', sale_date)::date
),
expenses_monthly as (
  select
    branch_id,
    date_trunc('month', expense_date)::date as month,
    sum(amount) as expense_total
  from public.expenses
  where not is_void
  group by branch_id, date_trunc('month', expense_date)::date
),
purchases_monthly as (
  select
    branch_id,
    date_trunc('month', purchase_date)::date as month,
    sum(total_amount) as purchase_total
  from public.supplier_purchases
  group by branch_id, date_trunc('month', purchase_date)::date
),
branch_months as (
  select branch_id, month from sales_monthly
  union
  select branch_id, month from expenses_monthly
  union
  select branch_id, month from purchases_monthly
)
select
  b.id as branch_id,
  b.name as branch_name,
  bm.month,
  coalesce(sm.sales_total, 0) as sales_total,
  coalesce(sm.panel_sales_total, 0) as panel_sales_total,
  coalesce(em.expense_total, 0) as expense_total,
  coalesce(pm.purchase_total, 0) as purchase_total
from branch_months bm
join public.branches b on b.id = bm.branch_id
left join sales_monthly sm on sm.branch_id = bm.branch_id and sm.month = bm.month
left join expenses_monthly em on em.branch_id = bm.branch_id and em.month = bm.month
left join purchases_monthly pm on pm.branch_id = bm.branch_id and pm.month = bm.month;

create or replace view public.v_profit_loss_monthly
with (security_invoker = on) as
with months as (
  select distinct date_trunc('month', sale_date)::date as month
  from public.daily_sales
  where not is_void
  union
  select distinct date_trunc('month', expense_date)::date as month
  from public.expenses
  where not is_void
  union
  select distinct date_trunc('month', purchase_date)::date as month from public.supplier_purchases
)
select
  m.month,
  coalesce((select sum(total_amount) from public.daily_sales where not is_void and date_trunc('month', sale_date)::date = m.month), 0) as revenue,
  coalesce((select sum(amount) from public.expenses where not is_void and date_trunc('month', expense_date)::date = m.month), 0) as operating_expenses,
  coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as purchase_cost,
  coalesce((select sum(total_amount) from public.daily_sales where not is_void and date_trunc('month', sale_date)::date = m.month), 0)
    - coalesce((select sum(amount) from public.expenses where not is_void and date_trunc('month', expense_date)::date = m.month), 0)
    - coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as net_profit
from months m;
