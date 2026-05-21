-- Phase 2: manual bank transactions for movements outside daily sales and cash bank-ins.
-- Run after supabase/bank-account-permissions.sql.

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  related_bank_account_id uuid references public.bank_accounts(id) on delete restrict,
  transfer_group_id uuid,
  transaction_date date not null,
  transaction_type text not null check (
    transaction_type in ('money_in', 'money_out', 'interbank_transfer', 'owner_drawing')
  ),
  direction text not null check (direction in ('in', 'out')),
  category text,
  amount numeric(12,2) not null check (amount > 0),
  description text,
  reference_no text,
  branch_id uuid references public.branches(id) on delete set null,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      transaction_type = 'money_in'
      and direction = 'in'
      and related_bank_account_id is null
      and transfer_group_id is null
    )
    or (
      transaction_type in ('money_out', 'owner_drawing')
      and direction = 'out'
      and related_bank_account_id is null
      and transfer_group_id is null
    )
    or (
      transaction_type = 'interbank_transfer'
      and related_bank_account_id is not null
      and related_bank_account_id <> bank_account_id
      and transfer_group_id is not null
    )
  )
);

create index if not exists bank_transactions_account_date_idx
on public.bank_transactions (bank_account_id, transaction_date desc);

create index if not exists bank_transactions_transfer_group_idx
on public.bank_transactions (transfer_group_id)
where transfer_group_id is not null;

drop trigger if exists set_bank_transactions_updated_at on public.bank_transactions;
create trigger set_bank_transactions_updated_at before update on public.bank_transactions
for each row execute function public.set_updated_at();

create or replace function public.can_access_manual_bank_account(target_bank_account_id uuid, access_mode text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() in ('admin', 'finance', 'branch_pic')
      and exists (
        select 1
        from public.bank_account_permissions bap
        where bap.user_id = auth.uid()
          and bap.bank_account_id = target_bank_account_id
          and (
            (access_mode = 'view' and bap.can_view)
            or (access_mode = 'create_transaction' and (bap.can_create_transaction or bap.can_manage_account))
            or (access_mode = 'edit_transaction' and (bap.can_edit_transaction or bap.can_manage_account))
          )
      )
    )
$$;

alter table public.bank_transactions enable row level security;

drop policy if exists "Owner can manage bank transactions" on public.bank_transactions;
create policy "Owner can manage bank transactions"
on public.bank_transactions for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Assigned users can read bank transactions" on public.bank_transactions;
create policy "Assigned users can read bank transactions"
on public.bank_transactions for select
to authenticated
using (public.can_access_manual_bank_account(bank_account_id, 'view'));

drop policy if exists "Assigned users can create bank transactions" on public.bank_transactions;
create policy "Assigned users can create bank transactions"
on public.bank_transactions for insert
to authenticated
with check (public.can_access_manual_bank_account(bank_account_id, 'create_transaction'));

drop policy if exists "Assigned users can update bank transactions" on public.bank_transactions;
create policy "Assigned users can update bank transactions"
on public.bank_transactions for update
to authenticated
using (public.can_access_manual_bank_account(bank_account_id, 'edit_transaction'))
with check (public.can_access_manual_bank_account(bank_account_id, 'edit_transaction'));
