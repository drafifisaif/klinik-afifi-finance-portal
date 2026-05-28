alter table public.supplier_purchases
  add column if not exists is_void boolean not null default false,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null;

alter table public.supplier_purchases
  drop constraint if exists supplier_purchases_void_reason_check,
  add constraint supplier_purchases_void_reason_check
  check (not is_void or (voided_at is not null and nullif(btrim(void_reason), '') is not null));

create index if not exists idx_supplier_purchases_is_void
on public.supplier_purchases(is_void);

create index if not exists supplier_purchases_active_branch_date_idx
on public.supplier_purchases (branch_id, purchase_date desc)
where not is_void;

notify pgrst, 'reload schema';
