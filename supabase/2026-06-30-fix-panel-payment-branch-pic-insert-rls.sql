drop policy if exists "Finance can write panel payments" on public.panel_payments;
drop policy if exists "Assigned users can create panel payments" on public.panel_payments;

create policy "Assigned users can create panel payments"
on public.panel_payments for insert
to authenticated
with check (
  (
    public.current_user_role() in ('owner', 'admin', 'finance')
    and exists (
      select 1
      from public.panel_claims c
      where c.id = public.panel_payments.panel_claim_id
        and public.can_access_branch(c.branch_id)
    )
    and (
      public.panel_payments.bank_account_id is null
      or public.can_access_bank_account(public.panel_payments.bank_account_id, 'create_transaction')
    )
  )
  or (
    public.current_user_role() = 'branch_pic'
    and exists (
      select 1
      from public.panel_claims c
      where c.id = public.panel_payments.panel_claim_id
        and c.branch_id = public.current_user_branch_id()
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
  )
);

notify pgrst, 'reload schema';
