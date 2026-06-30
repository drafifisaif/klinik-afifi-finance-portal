-- Klinik Afifi Finance Portal V1 MVP
-- Run this file in the Supabase SQL editor after creating your project.

create extension if not exists "pgcrypto";

do $$
begin
  create type public.user_role as enum ('owner', 'admin', 'finance', 'branch_pic', 'staff');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_type as enum ('cash', 'bank_transfer', 'card', 'panel', 'qr');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.expense_category as enum (
    'salary',
    'locum_doctor',
    'rental',
    'utilities',
    'supplier',
    'medicine',
    'consumables',
    'maintenance',
    'marketing',
    'loan_financing',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.purchase_category as enum ('medicine', 'consumables', 'other');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum ('unpaid', 'partial', 'paid', 'overdue');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'staff',
  branch_id uuid references public.branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  sale_date date not null,
  cash_amount numeric(12,2) not null default 0 check (cash_amount >= 0),
  bank_transfer_amount numeric(12,2) not null default 0 check (bank_transfer_amount >= 0),
  card_amount numeric(12,2) not null default 0 check (card_amount >= 0),
  panel_amount numeric(12,2) not null default 0 check (panel_amount >= 0),
  qr_amount numeric(12,2) not null default 0 check (qr_amount >= 0),
  total_amount numeric(12,2) generated always as (
    cash_amount + bank_transfer_amount + card_amount + panel_amount + qr_amount
  ) stored,
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, sale_date)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  expense_date date not null,
  category public.expense_category not null,
  vendor_name text,
  description text not null,
  payment_type public.payment_type not null default 'bank_transfer',
  amount numeric(12,2) not null check (amount >= 0),
  receipt_path text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text,
  phone text,
  email text,
  address text,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_no text,
  purchase_date date not null,
  due_date date,
  category public.purchase_category not null,
  medicine_cost numeric(12,2) not null default 0 check (medicine_cost >= 0),
  consumables_cost numeric(12,2) not null default 0 check (consumables_cost >= 0),
  other_cost numeric(12,2) not null default 0 check (other_cost >= 0),
  total_amount numeric(12,2) generated always as (
    medicine_cost + consumables_cost + other_cost
  ) stored,
  attachment_path text,
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.supplier_purchases(id) on delete cascade,
  item_name text not null,
  category public.purchase_category not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_cost) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_id uuid references public.supplier_purchases(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  payment_date date not null,
  payment_type public.payment_type not null default 'bank_transfer',
  amount numeric(12,2) not null check (amount > 0),
  reference_no text,
  receipt_path text,
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.panel_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text,
  phone text,
  email text,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.panel_claims (
  id uuid primary key default gen_random_uuid(),
  panel_company_id uuid not null references public.panel_companies(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  claim_no text,
  claim_month date not null,
  submitted_date date,
  due_date date,
  amount numeric(12,2) not null check (amount >= 0),
  status public.payment_status not null default 'unpaid',
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.panel_payments (
  id uuid primary key default gen_random_uuid(),
  panel_claim_id uuid not null references public.panel_claims(id) on delete cascade,
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_type public.payment_type not null default 'bank_transfer',
  reference_no text,
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_name text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_branches_updated_at on public.branches;
create trigger set_branches_updated_at before update on public.branches
for each row execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_sales_updated_at on public.daily_sales;
create trigger set_daily_sales_updated_at before update on public.daily_sales
for each row execute function public.set_updated_at();

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at before update on public.expenses
for each row execute function public.set_updated_at();

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();

drop trigger if exists set_supplier_purchases_updated_at on public.supplier_purchases;
create trigger set_supplier_purchases_updated_at before update on public.supplier_purchases
for each row execute function public.set_updated_at();

drop trigger if exists set_supplier_payments_updated_at on public.supplier_payments;
create trigger set_supplier_payments_updated_at before update on public.supplier_payments
for each row execute function public.set_updated_at();

drop trigger if exists set_panel_companies_updated_at on public.panel_companies;
create trigger set_panel_companies_updated_at before update on public.panel_companies
for each row execute function public.set_updated_at();

drop trigger if exists set_panel_claims_updated_at on public.panel_claims;
create trigger set_panel_claims_updated_at before update on public.panel_claims
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace view public.v_monthly_branch_finance
with (security_invoker = on) as
with sales_monthly as (
  select
    branch_id,
    date_trunc('month', sale_date)::date as month,
    sum(total_amount) as sales_total,
    sum(panel_amount) as panel_sales_total
  from public.daily_sales
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

create or replace view public.v_supplier_outstanding
with (security_invoker = on) as
select
  p.id as purchase_id,
  p.supplier_id,
  s.name as supplier_name,
  p.branch_id,
  b.name as branch_name,
  p.invoice_no,
  p.purchase_date,
  p.due_date,
  p.total_amount,
  coalesce(sum(pay.amount), 0) as paid_amount,
  p.total_amount - coalesce(sum(pay.amount), 0) as outstanding_amount,
  case
    when p.total_amount - coalesce(sum(pay.amount), 0) <= 0 then 'paid'
    when p.due_date is not null and p.due_date < current_date then 'overdue'
    when coalesce(sum(pay.amount), 0) > 0 then 'partial'
    else 'unpaid'
  end as status
from public.supplier_purchases p
join public.suppliers s on s.id = p.supplier_id
join public.branches b on b.id = p.branch_id
left join public.supplier_payments pay on pay.purchase_id = p.id
group by p.id, p.supplier_id, s.name, p.branch_id, b.name;

create or replace view public.v_panel_outstanding
with (security_invoker = on) as
select
  c.id as claim_id,
  c.panel_company_id,
  pc.name as panel_company_name,
  c.branch_id,
  b.name as branch_name,
  c.claim_no,
  c.claim_month,
  c.submitted_date,
  c.due_date,
  c.amount,
  coalesce(sum(pp.amount), 0) as paid_amount,
  c.amount - coalesce(sum(pp.amount), 0) as outstanding_amount,
  case
    when c.amount - coalesce(sum(pp.amount), 0) <= 0 then 'paid'
    when c.due_date is not null and c.due_date < current_date then 'overdue'
    when coalesce(sum(pp.amount), 0) > 0 then 'partial'
    else c.status::text
  end as status,
  case
    when c.due_date is null then 'no_due_date'
    when current_date - c.due_date <= 0 then 'current'
    when current_date - c.due_date <= 30 then '1_30_days'
    when current_date - c.due_date <= 60 then '31_60_days'
    when current_date - c.due_date <= 90 then '61_90_days'
    else '90_plus_days'
  end as aging_bucket
from public.panel_claims c
join public.panel_companies pc on pc.id = c.panel_company_id
join public.branches b on b.id = c.branch_id
left join public.panel_payments pp on pp.panel_claim_id = c.id
group by c.id, c.panel_company_id, pc.name, c.branch_id, b.name;

create or replace view public.v_profit_loss_monthly
with (security_invoker = on) as
with months as (
  select distinct date_trunc('month', sale_date)::date as month from public.daily_sales
  union
  select distinct date_trunc('month', expense_date)::date as month from public.expenses
  union
  select distinct date_trunc('month', purchase_date)::date as month from public.supplier_purchases
)
select
  m.month,
  coalesce((select sum(total_amount) from public.daily_sales where date_trunc('month', sale_date)::date = m.month), 0) as revenue,
  coalesce((select sum(amount) from public.expenses where date_trunc('month', expense_date)::date = m.month), 0) as operating_expenses,
  coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as purchase_cost,
  coalesce((select sum(total_amount) from public.daily_sales where date_trunc('month', sale_date)::date = m.month), 0)
    - coalesce((select sum(amount) from public.expenses where date_trunc('month', expense_date)::date = m.month), 0)
    - coalesce((select sum(total_amount) from public.supplier_purchases where date_trunc('month', purchase_date)::date = m.month), 0) as net_profit
from months m;

insert into public.branches (name, code)
values
  ('Putatan', 'PUT'),
  ('Papar', 'PAP'),
  ('Ranau', 'RAN'),
  ('Kinabatangan', 'KIN')
on conflict (code) do nothing;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.daily_sales enable row level security;
alter table public.expenses enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_purchases enable row level security;
alter table public.supplier_purchase_items enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.panel_companies enable row level security;
alter table public.panel_claims enable row level security;
alter table public.panel_payments enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_management()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'admin', 'finance')
$$;

create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_management()
    or target_branch_id = public.current_user_branch_id()
$$;

drop policy if exists "Authenticated users can read branches" on public.branches;
create policy "Authenticated users can read branches"
on public.branches for select
to authenticated
using (true);

drop policy if exists "Management can manage branches" on public.branches;
create policy "Management can manage branches"
on public.branches for all
to authenticated
using (public.current_user_role() in ('owner', 'admin'))
with check (public.current_user_role() in ('owner', 'admin'));

drop policy if exists "Users can read own profile and management can read all" on public.profiles;
create policy "Users can read own profile and management can read all"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_management());

drop policy if exists "Admins can manage profiles" on public.profiles;
create policy "Admins can manage profiles"
on public.profiles for all
to authenticated
using (
  public.current_user_role() = 'owner'
  or (public.current_user_role() = 'admin' and role <> 'owner')
)
with check (
  public.current_user_role() = 'owner'
  or (public.current_user_role() = 'admin' and role <> 'owner')
);

drop policy if exists "Branch scoped sales read" on public.daily_sales;
create policy "Branch scoped sales read"
on public.daily_sales for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped sales write" on public.daily_sales;
create policy "Branch scoped sales write"
on public.daily_sales for insert
to authenticated
with check (public.can_access_branch(branch_id));

drop policy if exists "Management and finance update sales" on public.daily_sales;
create policy "Management and finance update sales"
on public.daily_sales for update
to authenticated
using (public.can_access_branch(branch_id) and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic'))
with check (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped expenses read" on public.expenses;
create policy "Branch scoped expenses read"
on public.expenses for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped expenses write" on public.expenses;
create policy "Branch scoped expenses write"
on public.expenses for insert
to authenticated
with check (public.can_access_branch(branch_id));

drop policy if exists "Finance can update expenses" on public.expenses;
create policy "Finance can update expenses"
on public.expenses for update
to authenticated
using (public.can_access_branch(branch_id) and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic'))
with check (public.can_access_branch(branch_id));

drop policy if exists "Authenticated users can read suppliers" on public.suppliers;
create policy "Authenticated users can read suppliers"
on public.suppliers for select
to authenticated
using (true);

drop policy if exists "Finance can manage suppliers" on public.suppliers;
create policy "Finance can manage suppliers"
on public.suppliers for all
to authenticated
using (public.current_user_role() in ('owner', 'admin', 'finance'))
with check (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Branch scoped supplier purchases read" on public.supplier_purchases;
create policy "Branch scoped supplier purchases read"
on public.supplier_purchases for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped supplier purchases write" on public.supplier_purchases;
create policy "Branch scoped supplier purchases write"
on public.supplier_purchases for insert
to authenticated
with check (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped purchase items read" on public.supplier_purchase_items;
create policy "Branch scoped purchase items read"
on public.supplier_purchase_items for select
to authenticated
using (
  exists (
    select 1 from public.supplier_purchases p
    where p.id = purchase_id and public.can_access_branch(p.branch_id)
  )
);

drop policy if exists "Branch scoped purchase items write" on public.supplier_purchase_items;
create policy "Branch scoped purchase items write"
on public.supplier_purchase_items for insert
to authenticated
with check (
  exists (
    select 1 from public.supplier_purchases p
    where p.id = purchase_id and public.can_access_branch(p.branch_id)
  )
);

drop policy if exists "Branch scoped supplier payments read" on public.supplier_payments;
create policy "Branch scoped supplier payments read"
on public.supplier_payments for select
to authenticated
using (
  public.is_management()
  or (branch_id is not null and public.can_access_branch(branch_id))
);

drop policy if exists "Finance can write supplier payments" on public.supplier_payments;
create policy "Finance can write supplier payments"
on public.supplier_payments for insert
to authenticated
with check (
  (
    public.current_user_role() in ('owner', 'admin', 'finance')
    and (branch_id is null or public.can_access_branch(branch_id))
  )
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id is not null
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Authenticated users can read panel companies" on public.panel_companies;
create policy "Authenticated users can read panel companies"
on public.panel_companies for select
to authenticated
using (true);

drop policy if exists "Finance can manage panel companies" on public.panel_companies;
create policy "Finance can manage panel companies"
on public.panel_companies for all
to authenticated
using (public.current_user_role() in ('owner', 'admin', 'finance'))
with check (public.current_user_role() in ('owner', 'admin', 'finance'));

drop policy if exists "Branch scoped panel claims read" on public.panel_claims;
create policy "Branch scoped panel claims read"
on public.panel_claims for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped panel claims write" on public.panel_claims;
create policy "Branch scoped panel claims write"
on public.panel_claims for insert
to authenticated
with check (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped panel payments read" on public.panel_payments;
create policy "Branch scoped panel payments read"
on public.panel_payments for select
to authenticated
using (
  exists (
    select 1 from public.panel_claims c
    where c.id = panel_claim_id and public.can_access_branch(c.branch_id)
  )
);

drop policy if exists "Finance can write panel payments" on public.panel_payments;
drop policy if exists "Assigned users can create panel payments" on public.panel_payments;
create policy "Assigned users can create panel payments"
on public.panel_payments for insert
to authenticated
with check (
  (
    public.current_user_role() in ('owner', 'admin', 'finance')
    and exists (
      select 1 from public.panel_claims c
      where c.id = panel_claim_id and public.can_access_branch(c.branch_id)
    )
    and (
      bank_account_id is null
      or public.can_access_bank_account(bank_account_id, 'create_transaction')
    )
  )
  or (
    public.current_user_role() = 'branch_pic'
    and exists (
      select 1
      from public.panel_claims c
      where c.id = panel_claim_id
        and c.branch_id = public.current_user_branch_id()
    )
    and (
      bank_account_id is null
      or exists (
        select 1
        from public.branch_bank_mappings bbm
        join public.bank_accounts ba on ba.id = bbm.bank_account_id
        where bbm.branch_id = public.current_user_branch_id()
          and bbm.bank_account_id = public.panel_payments.bank_account_id
          and bbm.is_active = true
          and ba.is_active = true
      )
    )
  )
);

drop policy if exists "Management can read audit events" on public.audit_events;
create policy "Management can read audit events"
on public.audit_events for select
to authenticated
using (public.current_user_role() in ('owner', 'admin'));

insert into storage.buckets (id, name, public)
values
  ('finance-receipts', 'finance-receipts', false),
  ('supplier-invoices', 'supplier-invoices', false),
  ('panel-documents', 'panel-documents', false)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload finance files" on storage.objects;
create policy "Authenticated users can upload finance files"
on storage.objects for insert
to authenticated
with check (bucket_id in ('finance-receipts', 'supplier-invoices', 'panel-documents'));

drop policy if exists "Authenticated users can read finance files" on storage.objects;
create policy "Authenticated users can read finance files"
on storage.objects for select
to authenticated
using (bucket_id in ('finance-receipts', 'supplier-invoices', 'panel-documents'));
