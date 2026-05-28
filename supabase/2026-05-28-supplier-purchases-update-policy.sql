drop policy if exists "Branch scoped supplier purchases update" on public.supplier_purchases;

create policy "Branch scoped supplier purchases update"
on public.supplier_purchases
for update
to authenticated
using (public.can_access_branch(branch_id))
with check (public.can_access_branch(branch_id));
