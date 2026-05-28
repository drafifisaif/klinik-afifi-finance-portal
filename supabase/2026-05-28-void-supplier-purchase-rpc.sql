alter table public.supplier_purchases no force row level security;
alter table public.profiles no force row level security;

create or replace function public.void_supplier_purchase(
  p_purchase_id uuid,
  p_void_reason text
)
returns public.supplier_purchases
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  current_profile public.profiles%rowtype;
  existing_purchase public.supplier_purchases%rowtype;
  voided_purchase public.supplier_purchases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if nullif(btrim(p_void_reason), '') is null then
    raise exception 'Void reason is required.' using errcode = '22023';
  end if;

  select *
  into current_profile
  from public.profiles
  where id = auth.uid()
    and is_active
  limit 1;

  if not found then
    raise exception 'You do not have permission to void this supplier purchase.' using errcode = '42501';
  end if;

  select *
  into existing_purchase
  from public.supplier_purchases
  where id = p_purchase_id;

  if not found then
    raise exception 'Supplier purchase not found.' using errcode = 'P0002';
  end if;

  if current_profile.role in ('owner', 'admin', 'finance') then
    null;
  elsif current_profile.role = 'branch_pic' then
    if current_profile.branch_id is distinct from existing_purchase.branch_id then
      raise exception 'You do not have permission to void this supplier purchase.' using errcode = '42501';
    end if;
  else
    raise exception 'You do not have permission to void this supplier purchase.' using errcode = '42501';
  end if;

  if coalesce(existing_purchase.is_void, false) then
    raise exception 'Supplier purchase is already voided.' using errcode = '22023';
  end if;

  update public.supplier_purchases
  set is_void = true,
      void_reason = p_void_reason,
      voided_at = now(),
      voided_by = current_profile.id,
      updated_at = now()
  where id = existing_purchase.id
  returning *
  into voided_purchase;

  return voided_purchase;
end;
$$;

alter function public.void_supplier_purchase(uuid, text) owner to postgres;

revoke all on function public.void_supplier_purchase(uuid, text) from public;
grant execute on function public.void_supplier_purchase(uuid, text) to authenticated;

notify pgrst, 'reload schema';
