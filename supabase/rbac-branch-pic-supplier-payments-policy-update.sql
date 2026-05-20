-- Apply this after the V1 schema to allow Branch PIC supplier payments
-- only for their assigned branch, while preserving all-branch access for
-- Owner/Admin/Finance.

drop policy if exists "Branch scoped supplier payments read" on public.supplier_payments;

create policy "Branch scoped supplier payments read"
on public.supplier_payments for select
to authenticated
using (
  public.is_management()
  or (branch_id is not null and public.can_access_branch(branch_id))
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
);
