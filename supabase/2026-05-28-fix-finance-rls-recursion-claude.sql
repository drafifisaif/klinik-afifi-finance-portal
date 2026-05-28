-- Flatten finance branch/profile helpers to avoid recursive RLS evaluation.
-- Run this after earlier supplier purchase/RPC migrations.

alter table public.supplier_purchases no force row level security;
alter table public.profiles no force row level security;

create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('owner', 'admin', 'finance')
        or (p.role in ('branch_pic', 'staff') and p.branch_id = target_branch_id)
      )
  )
$$;

alter function public.can_access_branch(uuid) owner to postgres;
revoke all on function public.can_access_branch(uuid) from public;
grant execute on function public.can_access_branch(uuid) to authenticated;

create or replace function public.can_update_supplier_purchase(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('owner', 'admin', 'finance')
        or (p.role = 'branch_pic' and p.branch_id = target_branch_id)
      )
  )
$$;

alter function public.can_update_supplier_purchase(uuid) owner to postgres;
revoke all on function public.can_update_supplier_purchase(uuid) from public;
grant execute on function public.can_update_supplier_purchase(uuid) to authenticated;

create or replace function public.can_read_all_profiles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role in ('owner', 'admin', 'finance')
  )
$$;

alter function public.can_read_all_profiles() owner to postgres;
revoke all on function public.can_read_all_profiles() from public;
grant execute on function public.can_read_all_profiles() to authenticated;

drop policy if exists "Users can read own profile and management can read all" on public.profiles;
create policy "Users can read own profile and management can read all"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.can_read_all_profiles());

drop policy if exists "Branch scoped supplier purchases read" on public.supplier_purchases;
create policy "Branch scoped supplier purchases read"
on public.supplier_purchases for select
to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped supplier purchases write" on public.supplier_purchases;
create policy "Branch scoped supplier purchases write"
on public.supplier_purchases for insert
to authenticated
with check (public.can_access_branch(branch_id));

drop policy if exists "Branch scoped supplier purchases update" on public.supplier_purchases;
create policy "Branch scoped supplier purchases update"
on public.supplier_purchases for update
to authenticated
using (public.can_update_supplier_purchase(branch_id))
with check (public.can_update_supplier_purchase(branch_id));

notify pgrst, 'reload schema';

-- Verification queries to run manually in Supabase SQL Editor if needed:
-- select p.proname, r.rolname as owner, p.prosecdef as security_definer,
--        pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p
-- join pg_roles r on r.oid = p.proowner
-- where p.proname in ('can_access_branch', 'can_update_supplier_purchase', 'can_read_all_profiles');
--
-- select c.relname, c.relrowsecurity, c.relforcerowsecurity
-- from pg_class c
-- where c.oid in ('public.supplier_purchases'::regclass, 'public.profiles'::regclass);
--
-- select pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
--        pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
-- from pg_policy pol
-- where pol.polrelid in ('public.supplier_purchases'::regclass, 'public.profiles'::regclass)
-- order by pol.polrelid::regclass::text, pol.polname;
