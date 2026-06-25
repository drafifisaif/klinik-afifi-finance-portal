alter table public.suppliers
  add column if not exists code text;

alter table public.suppliers
  add column if not exists default_credit_term_days integer default 30;

update public.suppliers
set default_credit_term_days = coalesce(default_credit_term_days, payment_terms_days, 30)
where default_credit_term_days is null;

create unique index if not exists idx_suppliers_code_unique
  on public.suppliers (lower(code))
  where code is not null and btrim(code) <> '';

notify pgrst, 'reload schema';
