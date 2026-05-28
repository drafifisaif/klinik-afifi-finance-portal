create or replace function public.update_supplier_purchase(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_branch_id uuid,
  p_invoice_no text,
  p_invoice_date date,
  p_purchase_date date,
  p_credit_term_days integer,
  p_due_date date,
  p_category public.purchase_category,
  p_medicine_cost numeric,
  p_consumables_cost numeric,
  p_other_cost numeric,
  p_notes text
)
returns public.supplier_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  existing_purchase public.supplier_purchases%rowtype;
  updated_purchase public.supplier_purchases%rowtype;
  effective_branch_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into current_profile
  from public.profiles
  where id = auth.uid()
    and is_active
  limit 1;

  if not found then
    raise exception 'You do not have permission to edit this supplier purchase.' using errcode = '42501';
  end if;

  select *
  into existing_purchase
  from public.supplier_purchases
  where id = p_purchase_id;

  if not found then
    raise exception 'Supplier purchase not found.' using errcode = 'P0002';
  end if;

  if current_profile.role in ('owner', 'admin', 'finance') then
    effective_branch_id := p_branch_id;
  elsif current_profile.role = 'branch_pic' then
    if current_profile.branch_id is distinct from existing_purchase.branch_id then
      raise exception 'You do not have permission to edit this supplier purchase.' using errcode = '42501';
    end if;
    effective_branch_id := existing_purchase.branch_id;
  else
    raise exception 'You do not have permission to edit this supplier purchase.' using errcode = '42501';
  end if;

  update public.supplier_purchases
  set supplier_id = p_supplier_id,
      branch_id = effective_branch_id,
      invoice_no = p_invoice_no,
      invoice_date = p_invoice_date,
      purchase_date = p_purchase_date,
      credit_term_days = greatest(coalesce(p_credit_term_days, 0), 0),
      due_date = p_due_date,
      category = p_category,
      medicine_cost = coalesce(p_medicine_cost, 0),
      consumables_cost = coalesce(p_consumables_cost, 0),
      other_cost = coalesce(p_other_cost, 0),
      notes = p_notes,
      updated_at = now()
  where id = existing_purchase.id
  returning *
  into updated_purchase;

  return updated_purchase;
end;
$$;

alter function public.update_supplier_purchase(
  uuid,
  uuid,
  uuid,
  text,
  date,
  date,
  integer,
  date,
  public.purchase_category,
  numeric,
  numeric,
  numeric,
  text
) owner to postgres;

revoke all on function public.update_supplier_purchase(
  uuid,
  uuid,
  uuid,
  text,
  date,
  date,
  integer,
  date,
  public.purchase_category,
  numeric,
  numeric,
  numeric,
  text
) from public;

grant execute on function public.update_supplier_purchase(
  uuid,
  uuid,
  uuid,
  text,
  date,
  date,
  integer,
  date,
  public.purchase_category,
  numeric,
  numeric,
  numeric,
  text
) to authenticated;

notify pgrst, 'reload schema';
