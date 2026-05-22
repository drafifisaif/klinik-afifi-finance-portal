alter table public.supplier_payments
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete restrict;

alter table public.panel_payments
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete restrict;

create index if not exists supplier_payments_bank_account_date_idx
on public.supplier_payments (bank_account_id, payment_date desc)
where bank_account_id is not null;

create index if not exists panel_payments_bank_account_date_idx
on public.panel_payments (bank_account_id, payment_date desc)
where bank_account_id is not null;

drop policy if exists "Branch scoped supplier payments read" on public.supplier_payments;
create policy "Branch scoped supplier payments read"
on public.supplier_payments for select
to authenticated
using (
  (
    public.is_management()
    or (branch_id is not null and public.can_access_branch(branch_id))
  )
  and (
    bank_account_id is null
    or public.can_access_bank_account(bank_account_id, 'view')
  )
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
)
and (
  bank_account_id is null
  or public.can_access_bank_account(bank_account_id, 'create_transaction')
);

drop policy if exists "Branch scoped panel payments read" on public.panel_payments;
create policy "Branch scoped panel payments read"
on public.panel_payments for select
to authenticated
using (
  exists (
    select 1 from public.panel_claims c
    where c.id = panel_claim_id and public.can_access_branch(c.branch_id)
  )
  and (
    bank_account_id is null
    or public.can_access_bank_account(bank_account_id, 'view')
  )
);

drop policy if exists "Finance can write panel payments" on public.panel_payments;
create policy "Finance can write panel payments"
on public.panel_payments for insert
to authenticated
with check (
  public.current_user_role() in ('owner', 'admin', 'finance')
  and exists (
    select 1 from public.panel_claims c
    where c.id = panel_claim_id and public.can_access_branch(c.branch_id)
  )
  and (
    bank_account_id is null
    or public.can_access_bank_account(bank_account_id, 'create_transaction')
  )
);
