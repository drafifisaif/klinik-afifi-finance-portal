-- Phase 7: owner-managed opening balances for the 2026 starting position.
-- Run after supabase/phase6-transaction-documents.sql.

create table if not exists public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  balance_date date not null,
  balance_type text not null check (
    balance_type in (
      'bank_account',
      'cash_in_hand',
      'petty_cash',
      'supplier_outstanding',
      'panel_outstanding'
    )
  ),
  branch_id uuid references public.branches(id) on delete restrict,
  bank_account_id uuid references public.bank_accounts(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  panel_company_id uuid references public.panel_companies(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (balance_type = 'bank_account' and bank_account_id is not null and branch_id is null and supplier_id is null and panel_company_id is null)
    or (balance_type in ('cash_in_hand', 'petty_cash') and branch_id is not null and bank_account_id is null and supplier_id is null and panel_company_id is null)
    or (balance_type = 'supplier_outstanding' and supplier_id is not null and bank_account_id is null and panel_company_id is null)
    or (balance_type = 'panel_outstanding' and panel_company_id is not null and bank_account_id is null and supplier_id is null)
  )
);

create unique index if not exists opening_balances_bank_account_idx
on public.opening_balances (balance_date, balance_type, bank_account_id)
where balance_type = 'bank_account';

create unique index if not exists opening_balances_branch_idx
on public.opening_balances (balance_date, balance_type, branch_id)
where balance_type in ('cash_in_hand', 'petty_cash');

create unique index if not exists opening_balances_supplier_idx
on public.opening_balances (balance_date, balance_type, supplier_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
where balance_type = 'supplier_outstanding';

create unique index if not exists opening_balances_panel_idx
on public.opening_balances (balance_date, balance_type, panel_company_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
where balance_type = 'panel_outstanding';

drop trigger if exists set_opening_balances_updated_at on public.opening_balances;
create trigger set_opening_balances_updated_at before update on public.opening_balances
for each row execute function public.set_updated_at();

alter table public.opening_balances enable row level security;

drop policy if exists "Owner can manage opening balances" on public.opening_balances;
create policy "Owner can manage opening balances"
on public.opening_balances for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Assigned roles can read opening balances" on public.opening_balances;
create policy "Assigned roles can read opening balances"
on public.opening_balances for select
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() in ('admin', 'finance', 'branch_pic')
    and (
      (balance_type = 'bank_account' and public.can_access_bank_account(bank_account_id, 'view'))
      or (balance_type in ('cash_in_hand', 'petty_cash') and public.can_access_branch(branch_id))
      or (
        balance_type in ('supplier_outstanding', 'panel_outstanding')
        and (
          (branch_id is null and public.current_user_role() in ('admin', 'finance'))
          or public.can_access_branch(branch_id)
        )
      )
    )
  )
);
