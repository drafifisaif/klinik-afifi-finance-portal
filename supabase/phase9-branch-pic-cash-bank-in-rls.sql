-- Tighten cash bank-in RLS for Branch PIC mapped bank-in entry.
-- Run after supabase/phase8-branch-pic-cash-bank-in-target.sql.

alter table public.cash_bank_ins enable row level security;

drop policy if exists "Owner and branch PIC can read cash bank-ins" on public.cash_bank_ins;
drop policy if exists "Assigned users can read cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can read cash bank-ins"
on public.cash_bank_ins for select
to authenticated
using (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
  )
  or (
    public.current_user_role() in ('admin', 'finance')
    and public.can_access_bank_account(bank_account_id, 'view')
  )
);

drop policy if exists "Owner and branch PIC can create cash bank-ins" on public.cash_bank_ins;
drop policy if exists "Assigned users can create cash bank-ins" on public.cash_bank_ins;
create policy "Assigned users can create cash bank-ins"
on public.cash_bank_ins for insert
to authenticated
with check (
  public.current_user_role() = 'owner'
  or (
    public.current_user_role() = 'branch_pic'
    and branch_id = public.current_user_branch_id()
    and exists (
      select 1
      from public.branch_bank_mappings bbm
      where bbm.branch_id = public.cash_bank_ins.branch_id
        and bbm.bank_account_id = public.cash_bank_ins.bank_account_id
        and bbm.is_active
    )
  )
  or (
    public.current_user_role() in ('admin', 'finance')
    and public.can_access_bank_account(bank_account_id, 'create_transaction')
  )
);

drop policy if exists "Owner can update cash bank-ins" on public.cash_bank_ins;
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
