create table if not exists public.supplier_purchase_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  invoice_no text,
  invoice_date date,
  purchase_date date not null,
  credit_term_days integer not null default 0,
  due_date date,
  category text,
  medicine_cost numeric(12,2) not null default 0,
  consumables_cost numeric(12,2) not null default 0,
  other_cost numeric(12,2) not null default 0,
  total_amount numeric(12,2) generated always as (
    coalesce(medicine_cost, 0) + coalesce(consumables_cost, 0) + coalesce(other_cost, 0)
  ) stored,
  notes text,
  is_void boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_purchase_entries_void_reason_check check (
    not is_void or nullif(btrim(coalesce(void_reason, '')), '') is not null
  )
);

create index if not exists idx_supplier_purchase_entries_branch_id
  on public.supplier_purchase_entries(branch_id);

create index if not exists idx_supplier_purchase_entries_supplier_id
  on public.supplier_purchase_entries(supplier_id);

create index if not exists idx_supplier_purchase_entries_purchase_date
  on public.supplier_purchase_entries(purchase_date);

create index if not exists idx_supplier_purchase_entries_is_void
  on public.supplier_purchase_entries(is_void);

create index if not exists idx_supplier_purchase_entries_created_at
  on public.supplier_purchase_entries(created_at);

alter table public.supplier_purchase_entries enable row level security;

drop policy if exists "Authenticated users can read supplier purchase entries" on public.supplier_purchase_entries;
create policy "Authenticated users can read supplier purchase entries"
  on public.supplier_purchase_entries
  for select
  to authenticated
  using (auth.uid() is not null);

notify pgrst, 'reload schema';
