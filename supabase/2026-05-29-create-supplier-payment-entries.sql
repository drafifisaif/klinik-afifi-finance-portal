create table if not exists public.supplier_payment_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_purchase_entry_id uuid references public.supplier_purchase_entries(id),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  payment_date date not null,
  payment_method text,
  bank_account_id uuid references public.bank_accounts(id),
  amount numeric(12,2) not null default 0,
  reference_no text,
  notes text,
  is_void boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount >= 0),
  check (
    not is_void
    or (void_reason is not null and btrim(void_reason) <> '' and voided_at is not null and voided_by is not null)
  )
);

create index if not exists supplier_payment_entries_purchase_entry_idx
on public.supplier_payment_entries (supplier_purchase_entry_id);

create index if not exists supplier_payment_entries_supplier_idx
on public.supplier_payment_entries (supplier_id);

create index if not exists supplier_payment_entries_branch_idx
on public.supplier_payment_entries (branch_id);

create index if not exists supplier_payment_entries_payment_date_idx
on public.supplier_payment_entries (payment_date desc);

create index if not exists supplier_payment_entries_is_void_idx
on public.supplier_payment_entries (is_void);

create index if not exists supplier_payment_entries_bank_account_idx
on public.supplier_payment_entries (bank_account_id);

create index if not exists supplier_payment_entries_created_at_idx
on public.supplier_payment_entries (created_at desc);

alter table public.supplier_payment_entries enable row level security;

drop policy if exists "Supplier payment entries read" on public.supplier_payment_entries;
create policy "Supplier payment entries read"
on public.supplier_payment_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role in ('owner', 'admin', 'finance')
        or (p.role = 'branch_pic' and p.branch_id = supplier_payment_entries.branch_id)
      )
  )
);

notify pgrst, 'reload schema';
