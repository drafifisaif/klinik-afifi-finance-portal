-- Cash Bank-In finance role access for cash-control reporting.
-- Run this in Supabase SQL Editor, then refresh the PostgREST schema cache if needed.
--
-- Cash Bank-In is a branch cash-control record. Owner/admin/finance need role-level
-- visibility for reporting and historical cash-month correction. Branch PIC remains
-- restricted to own-branch records and active mapped bank accounts.

alter table public.cash_bank_ins enable row level security;

drop policy if exists "Assigned users can read cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can read cash bank-ins"
on public.cash_bank_ins for select
to authenticated
using (
  public.current_user_role() in ('owner', 'admin', 'finance')
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
);

drop policy if exists "Assigned users can create cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can create cash bank-ins"
on public.cash_bank_ins for insert
to authenticated
with check (
  public.current_user_role() in ('owner', 'admin', 'finance')
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
    and exists (
      select 1
      from public.branch_bank_mappings bbm
      join public.bank_accounts ba on ba.id = bbm.bank_account_id
      where bbm.branch_id = public.cash_bank_ins.branch_id
        and bbm.bank_account_id = public.cash_bank_ins.bank_account_id
        and bbm.is_active
        and ba.is_active
    )
  )
);

drop policy if exists "Assigned users can update cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can update cash bank-ins"
on public.cash_bank_ins for update
to authenticated
using (
  public.current_user_role() in ('owner', 'admin', 'finance')
  or (
    not is_void
    and public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
    and exists (
      select 1
      from public.branch_bank_mappings bbm
      join public.bank_accounts ba on ba.id = bbm.bank_account_id
      where bbm.branch_id = public.cash_bank_ins.branch_id
        and bbm.bank_account_id = public.cash_bank_ins.bank_account_id
        and bbm.is_active
        and ba.is_active
    )
  )
)
with check (
  public.current_user_role() in ('owner', 'admin', 'finance')
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
    and exists (
      select 1
      from public.branch_bank_mappings bbm
      join public.bank_accounts ba on ba.id = bbm.bank_account_id
      where bbm.branch_id = public.cash_bank_ins.branch_id
        and bbm.bank_account_id = public.cash_bank_ins.bank_account_id
        and bbm.is_active
        and ba.is_active
    )
  )
);

notify pgrst, 'reload schema';
