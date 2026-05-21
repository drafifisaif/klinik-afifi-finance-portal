-- Phase 5: controlled edit and void markers for finance correction records.
-- Run after supabase/phase4-audit-trail.sql.

alter table public.daily_sales
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.bank_transactions
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.petty_cash_transactions
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.cash_bank_ins
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

alter table public.daily_sales
  drop constraint if exists daily_sales_void_reason_check,
  add constraint daily_sales_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

alter table public.bank_transactions
  drop constraint if exists bank_transactions_void_reason_check,
  add constraint bank_transactions_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

alter table public.petty_cash_transactions
  drop constraint if exists petty_cash_transactions_void_reason_check,
  add constraint petty_cash_transactions_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

alter table public.cash_bank_ins
  drop constraint if exists cash_bank_ins_void_reason_check,
  add constraint cash_bank_ins_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

create index if not exists daily_sales_active_branch_date_idx
on public.daily_sales (branch_id, sale_date desc)
where not is_void;

create index if not exists bank_transactions_active_account_date_idx
on public.bank_transactions (bank_account_id, transaction_date desc)
where not is_void;

create index if not exists petty_cash_transactions_active_branch_date_idx
on public.petty_cash_transactions (branch_id, transaction_date desc)
where not is_void;

create index if not exists cash_bank_ins_active_branch_date_idx
on public.cash_bank_ins (branch_id, bank_in_date desc)
where not is_void;

drop policy if exists "Management and finance update sales" on public.daily_sales;
create policy "Management and finance update sales"
on public.daily_sales for update
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

drop policy if exists "Assigned users can update bank transactions" on public.bank_transactions;
create policy "Assigned users can update bank transactions"
on public.bank_transactions for update
to authenticated
using (
  not is_void
  and public.can_access_manual_bank_account(bank_account_id, 'edit_transaction')
  and (
    public.current_user_role() <> 'branch_pic'
    or branch_id = public.current_user_branch_id()
  )
)
with check (
  public.can_access_manual_bank_account(bank_account_id, 'edit_transaction')
  and (
    public.current_user_role() <> 'branch_pic'
    or branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Finance can update petty cash transactions" on public.petty_cash_transactions;
create policy "Finance can update petty cash transactions"
on public.petty_cash_transactions for update
to authenticated
using (
  not is_void
  and public.current_user_role() in ('admin', 'finance')
  and public.can_access_branch(branch_id)
  and transaction_type <> 'petty_cash_adjustment'
  and (
    bank_account_id is null
    or public.can_access_bank_account(bank_account_id, 'edit_transaction')
  )
)
with check (
  public.current_user_role() in ('admin', 'finance')
  and public.can_access_branch(branch_id)
  and transaction_type <> 'petty_cash_adjustment'
  and (
    bank_account_id is null
    or public.can_access_bank_account(bank_account_id, 'edit_transaction')
  )
);

drop policy if exists "Assigned users can update cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can update cash bank-ins"
on public.cash_bank_ins for update
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    not is_void
    and public.current_user_role() in ('admin', 'finance')
    and public.can_access_bank_account(bank_account_id, 'edit_transaction')
  )
)
with check (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() in ('admin', 'finance')
    and public.can_access_bank_account(bank_account_id, 'edit_transaction')
  )
);

drop view if exists public.v_monthly_branch_finance cascade;
create view public.v_monthly_branch_finance
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

drop view if exists public.v_profit_loss_monthly cascade;
create view public.v_profit_loss_monthly
with (security_invoker = on) as
with months as (
  select distinct date_trunc('month', sale_date)::date as month
  from public.daily_sales
  where not is_void
  union
  select distinct date_trunc('month', expense_date)::date as month from public.expenses
  union
  select distinct date_trunc('month', purchase_date)::date as month from public.supplier_purchases
)
select
  m.month,
  coalesce((select sum(total_amount) from public.daily_sales where not is_void and date_trunc('month', sale_date)::date = m.month), 0) as revenue,
  coalesce((select sum(amount) from public.expenses where date_trunc('month', expense_date)::date = m.month), 0) as operating_expenses,
  coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as purchase_cost,
  coalesce((select sum(total_amount) from public.daily_sales where not is_void and date_trunc('month', sale_date)::date = m.month), 0)
    - coalesce((select sum(amount) from public.expenses where date_trunc('month', expense_date)::date = m.month), 0)
    - coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as net_profit
from months m;

create or replace function public.log_audit_event(
  p_action text,
  p_entity_name text,
  p_entity_id uuid default null,
  p_branch_id uuid default null,
  p_bank_account_id uuid default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_changed_fields jsonb default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Audit event actor must be authenticated.';
  end if;

  if p_action not in ('create', 'update', 'void', 'delete', 'role_change', 'permission_change') then
    raise exception 'Unsupported audit action: %', p_action;
  end if;

  insert into public.audit_events (
    actor_id,
    actor_email,
    action,
    entity_name,
    entity_id,
    branch_id,
    bank_account_id,
    before_data,
    after_data,
    changed_fields,
    description
  )
  values (
    auth.uid(),
    nullif(auth.jwt()->>'email', ''),
    p_action,
    p_entity_name,
    p_entity_id,
    p_branch_id,
    p_bank_account_id,
    p_before_data,
    p_after_data,
    p_changed_fields,
    p_description
  )
  returning id into event_id;

  return event_id;
end;
$$;
