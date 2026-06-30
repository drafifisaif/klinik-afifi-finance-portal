drop policy if exists "Branch PIC can create own branch panel payments" on public.panel_payments;
create policy "Branch PIC can create own branch panel payments"
on public.panel_payments for insert
to authenticated
with check (
  public.current_user_role() = 'branch_pic'
  and exists (
    select 1
    from public.panel_claims pc
    where pc.id = public.panel_payments.panel_claim_id
      and pc.branch_id = public.current_user_branch_id()
  )
  and (
    public.panel_payments.bank_account_id is null
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
);

drop policy if exists "Branch PIC can read own branch panel payments" on public.panel_payments;
create policy "Branch PIC can read own branch panel payments"
on public.panel_payments for select
to authenticated
using (
  public.current_user_role() = 'branch_pic'
  and exists (
    select 1
    from public.panel_claims pc
    where pc.id = public.panel_payments.panel_claim_id
      and pc.branch_id = public.current_user_branch_id()
  )
  and (
    public.panel_payments.bank_account_id is null
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
);

notify pgrst, 'reload schema';
