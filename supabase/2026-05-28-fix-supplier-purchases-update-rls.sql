create or replace function public.can_update_supplier_purchase(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active
      and (
        role in ('owner', 'admin', 'finance')
        or (role = 'branch_pic' and branch_id = p_branch_id)
      )
  )
$$;

revoke all on function public.can_update_supplier_purchase(uuid) from public;
grant execute on function public.can_update_supplier_purchase(uuid) to authenticated;

drop policy if exists "Branch scoped supplier purchases update" on public.supplier_purchases;

create policy "Branch scoped supplier purchases update"
on public.supplier_purchases
for update
to authenticated
using (public.can_update_supplier_purchase(branch_id))
with check (public.can_update_supplier_purchase(branch_id));

notify pgrst, 'reload schema';
