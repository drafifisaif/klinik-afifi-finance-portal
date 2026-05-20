-- Bank account-level permissions for Bank Position access.
-- Run after supabase/phase1-bank-position.sql.

update public.bank_accounts
set name = 'CIMB Ranau Operation',
    bank_name = 'CIMB'
where name = 'CIMB Ranau';

update public.bank_accounts
set name = 'CIMB Putatan Operation',
    bank_name = 'CIMB'
where name = 'CIMB Putatan';

insert into public.bank_accounts (name, bank_name)
values
  ('CIMB Ranau Operation', 'CIMB'),
  ('CIMB Ranau Panel', 'CIMB'),
  ('CIMB Putatan Operation', 'CIMB'),
  ('CIMB Putatan Panel', 'CIMB'),
  ('Agrobank', 'Agrobank')
on conflict (name) do update
set bank_name = excluded.bank_name,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'CIMB Ranau Operation'
where b.name = 'Ranau'
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'CIMB Putatan Operation'
where b.name = 'Putatan'
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

insert into public.branch_bank_mappings (branch_id, bank_account_id)
select b.id, ba.id
from public.branches b
join public.bank_accounts ba on ba.name = 'Agrobank'
where b.name in ('Papar', 'Kinabatangan')
on conflict (branch_id) do update
set bank_account_id = excluded.bank_account_id,
    is_active = true;

create table if not exists public.bank_account_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  can_view boolean not null default true,
  can_create_transaction boolean not null default false,
  can_edit_transaction boolean not null default false,
  can_manage_account boolean not null default false,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bank_account_id)
);

alter table public.bank_account_permissions
  add column if not exists can_create_transaction boolean not null default false,
  add column if not exists can_edit_transaction boolean not null default false,
  add column if not exists can_manage_account boolean not null default false,
  add column if not exists granted_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bank_account_permissions'
      and column_name = 'can_edit'
  ) then
    update public.bank_account_permissions
    set can_create_transaction = can_create_transaction or can_edit,
        can_edit_transaction = can_edit_transaction or can_edit;
  end if;
end $$;

alter table public.bank_account_permissions
  drop constraint if exists bank_account_permissions_check,
  drop constraint if exists bank_account_permissions_has_capability;

alter table public.bank_account_permissions
  add constraint bank_account_permissions_has_capability
  check (can_view or can_create_transaction or can_edit_transaction or can_manage_account);

drop trigger if exists set_bank_account_permissions_updated_at on public.bank_account_permissions;
create trigger set_bank_account_permissions_updated_at before update on public.bank_account_permissions
for each row execute function public.set_updated_at();

create or replace function public.can_access_bank_account(target_bank_account_id uuid, access_mode text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or (
      access_mode = 'view'
      and public.current_user_role() = 'branch_pic'
      and exists (
        select 1
        from public.branch_bank_mappings bbm
        where bbm.bank_account_id = target_bank_account_id
          and bbm.branch_id = public.current_user_branch_id()
          and bbm.is_active
      )
    )
    or (
      public.current_user_role() in ('admin', 'finance', 'branch_pic')
      and exists (
        select 1
        from public.bank_account_permissions bap
        where bap.user_id = auth.uid()
          and bap.bank_account_id = target_bank_account_id
          and (
            (access_mode = 'view' and (bap.can_view or bap.can_create_transaction or bap.can_edit_transaction or bap.can_manage_account))
            or (access_mode = 'create_transaction' and (bap.can_create_transaction or bap.can_manage_account))
            or (access_mode = 'edit_transaction' and (bap.can_edit_transaction or bap.can_manage_account))
            or (access_mode = 'manage_account' and bap.can_manage_account)
          )
      )
    )
$$;

alter table public.bank_account_permissions enable row level security;

drop policy if exists "Owner can manage bank account permissions" on public.bank_account_permissions;
create policy "Owner can manage bank account permissions"
on public.bank_account_permissions for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Users can read own bank account permissions" on public.bank_account_permissions;
create policy "Users can read own bank account permissions"
on public.bank_account_permissions for select
to authenticated
using (public.current_user_role() = 'owner' or user_id = auth.uid());

drop policy if exists "Owner can manage bank accounts" on public.bank_accounts;
create policy "Owner can manage bank accounts"
on public.bank_accounts for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Owner and branch PIC can read active bank accounts" on public.bank_accounts;
drop policy if exists "Assigned users can read active bank accounts" on public.bank_accounts;
create policy "Assigned users can read active bank accounts"
on public.bank_accounts for select
to authenticated
using (is_active and public.can_access_bank_account(id, 'view'));

drop policy if exists "Owner can manage branch bank mappings" on public.branch_bank_mappings;
create policy "Owner can manage branch bank mappings"
on public.branch_bank_mappings for all
to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

drop policy if exists "Owner and branch PIC can read branch bank mappings" on public.branch_bank_mappings;
drop policy if exists "Assigned users can read branch bank mappings" on public.branch_bank_mappings;
create policy "Assigned users can read branch bank mappings"
on public.branch_bank_mappings for select
to authenticated
using (
  is_active
  and (
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() = 'branch_pic'
      and branch_id = public.current_user_branch_id()
    )
    or public.can_access_bank_account(bank_account_id, 'view')
  )
);

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
    public.current_user_role() in ('admin', 'finance')
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
