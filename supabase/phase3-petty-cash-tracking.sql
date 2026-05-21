-- Phase 3: branch petty cash / cash float tracking.
-- Run after supabase/phase2-manual-bank-transactions.sql.

create table if not exists public.petty_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  bank_account_id uuid references public.bank_accounts(id) on delete restrict,
  transaction_date date not null,
  transaction_type text not null check (
    transaction_type in ('petty_cash_issued', 'petty_cash_spent', 'petty_cash_returned', 'petty_cash_adjustment')
  ),
  direction text not null check (direction in ('in', 'out', 'adjustment')),
  category text,
  amount numeric(12,2) not null check (
    (transaction_type = 'petty_cash_adjustment' and amount <> 0)
    or (transaction_type <> 'petty_cash_adjustment' and amount > 0)
  ),
  description text,
  reference_no text,
  receipt_path text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      transaction_type = 'petty_cash_issued'
      and direction = 'in'
      and bank_account_id is not null
    )
    or (
      transaction_type = 'petty_cash_spent'
      and direction = 'out'
      and bank_account_id is null
    )
    or (
      transaction_type = 'petty_cash_returned'
      and direction = 'out'
      and bank_account_id is not null
    )
    or (
      transaction_type = 'petty_cash_adjustment'
      and direction = 'adjustment'
      and bank_account_id is null
    )
  )
);

create index if not exists petty_cash_transactions_branch_date_idx
on public.petty_cash_transactions (branch_id, transaction_date desc);

create index if not exists petty_cash_transactions_bank_date_idx
on public.petty_cash_transactions (bank_account_id, transaction_date desc)
where bank_account_id is not null;

drop trigger if exists set_petty_cash_transactions_updated_at on public.petty_cash_transactions;
create trigger set_petty_cash_transactions_updated_at before update on public.petty_cash_transactions
for each row execute function public.set_updated_at();

alter table public.petty_cash_transactions enable row level security;

drop policy if exists "Owner can manage petty cash transactions" on public.petty_cash_transactions;
create policy "Owner can manage petty cash transactions"
on public.petty_cash_transactions for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Assigned roles can read petty cash transactions" on public.petty_cash_transactions;
create policy "Assigned roles can read petty cash transactions"
on public.petty_cash_transactions for select
to authenticated
using (
  (
    public.current_user_role() in ('admin', 'finance')
    and public.can_access_branch(branch_id)
  )
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Assigned roles can create petty cash transactions" on public.petty_cash_transactions;
create policy "Assigned roles can create petty cash transactions"
on public.petty_cash_transactions for insert
to authenticated
with check (
  (
    public.current_user_role() in ('admin', 'finance')
    and public.can_access_branch(branch_id)
    and (
      transaction_type = 'petty_cash_spent'
      or (
        transaction_type in ('petty_cash_issued', 'petty_cash_returned')
        and public.can_access_bank_account(bank_account_id, 'create_transaction')
      )
    )
  )
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
    and transaction_type in ('petty_cash_spent', 'petty_cash_returned')
    and (
      transaction_type = 'petty_cash_spent'
      or public.can_access_bank_account(bank_account_id, 'view')
    )
  )
);

drop policy if exists "Finance can update petty cash transactions" on public.petty_cash_transactions;
create policy "Finance can update petty cash transactions"
on public.petty_cash_transactions for update
to authenticated
using (
  public.current_user_role() in ('admin', 'finance')
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
