-- Apply this after the V1 schema if profiles RLS is already deployed.
-- It prevents Admin users from editing Owner profiles or assigning the Owner role.

drop policy if exists "Admins can manage profiles" on public.profiles;

create policy "Admins can manage profiles"
on public.profiles for all
to authenticated
using (
  public.current_user_role() = 'owner'
  or (public.current_user_role() = 'admin' and role <> 'owner')
)
with check (
  public.current_user_role() = 'owner'
  or (public.current_user_role() = 'admin' and role <> 'owner')
);
