-- Phase 1: Owner-only bank position, direct bank inflow, cash bank-in, and cash in hand.
-- Run after the base schema/RLS has been installed.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  bank_name text,
  account_no text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branch_bank_mappings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id)
);

create table if not exists public.cash_bank_ins (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  bank_in_date date not null,
  cash_source_date date,
  amount numeric(12,2) not null check (amount > 0),
  reference_no text,
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_bank_accounts_updated_at on public.bank_accounts;
create trigger set_bank_accounts_updated_at before update on public.bank_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_branch_bank_mappings_updated_at on public.branch_bank_mappings;
create trigger set_branch_bank_mappings_updated_at before update on public.branch_bank_mappings
for each row execute function public.set_updated_at();

drop trigger if exists set_cash_bank_ins_updated_at on public.cash_bank_ins;
create trigger set_cash_bank_ins_updated_at before update on public.cash_bank_ins
for each row execute function public.set_updated_at();

insert into public.bank_accounts (name, bank_name)
values
  ('CIMB Ranau', 'CIMB'),
  ('CIMB Putatan', 'CIMB'),
  ('Agrobank', 'Agrobank')
on conflict (name) do update
set bank_name = excluded.bank_name,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'CIMB Ranau'
where b.name = 'Ranau'
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'CIMB Putatan'
where b.name = 'Putatan'
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'Agrobank'
where b.name in ('Papar', 'Kinabatangan')
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

alter table public.bank_accounts enable row level security;
alter table public.branch_bank_mappings enable row level security;
alter table public.cash_bank_ins enable row level security;

drop policy if exists "Owner can manage bank accounts" on public.bank_accounts;
create policy "Owner can manage bank accounts"
on public.bank_accounts for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Owner and branch PIC can read active bank accounts" on public.bank_accounts;
create policy "Owner and branch PIC can read active bank accounts"
on public.bank_accounts for select
to authenticated
using (is_active and public.current_user_role() in ('owner', 'branch_pic'));

drop policy if exists "Owner can manage branch bank mappings" on public.branch_bank_mappings;
create policy "Owner can manage branch bank mappings"
on public.branch_bank_mappings for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Owner and branch PIC can read branch bank mappings" on public.branch_bank_mappings;
create policy "Owner and branch PIC can read branch bank mappings"
on public.branch_bank_mappings for select
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Owner and branch PIC can read cash bank-ins" on public.cash_bank_ins;
create policy "Owner and branch PIC can read cash bank-ins"
on public.cash_bank_ins for select
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Owner and branch PIC can create cash bank-ins" on public.cash_bank_ins;
create policy "Owner and branch PIC can create cash bank-ins"
on public.cash_bank_ins for insert
to authenticated
with check (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Owner can update cash bank-ins" on public.cash_bank_ins;
create policy "Owner can update cash bank-ins"
on public.cash_bank_ins for update
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');
