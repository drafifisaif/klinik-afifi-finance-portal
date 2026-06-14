alter table public.suppliers
  add column if not exists code text;

create unique index if not exists idx_suppliers_code_unique
  on public.suppliers (lower(code))
  where code is not null and btrim(code) <> '';

notify pgrst, 'reload schema';
