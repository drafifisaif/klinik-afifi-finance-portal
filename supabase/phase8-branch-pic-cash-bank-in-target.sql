-- Phase 8: Branch PIC cash bank-in target reads from own branch mapping only.
-- Run after supabase/bank-account-permissions.sql.

drop policy if exists "Branch PIC can read own cash bank-in mapping" on public.branch_bank_mappings;
create policy "Branch PIC can read own cash bank-in mapping"
on public.branch_bank_mappings for select
to authenticated
using (
  is_active
  and public.current_user_role() = 'branch_pic'
  and branch_id = public.current_user_branch_id()
);

drop policy if exists "Branch PIC can read own mapped cash bank-in bank account" on public.bank_accounts;
create policy "Branch PIC can read own mapped cash bank-in bank account"
on public.bank_accounts for select
to authenticated
using (
  is_active
  and public.current_user_role() = 'branch_pic'
  and exists (
    select 1
    from public.branch_bank_mappings bbm
    where bbm.bank_account_id = bank_accounts.id
      and bbm.branch_id = public.current_user_branch_id()
      and bbm.is_active
  )
);
