-- Distinguish cash-control attribution date from actual bank deposit date.
-- bank_in_date remains the actual date money entered the bank.
-- cash_source_date is the branch cash period/date that the banked cash belongs to.

alter table public.cash_bank_ins
  add column if not exists cash_source_date date,
  add column if not exists cash_month date,
  add column if not exists cash_sales_from date,
  add column if not exists cash_sales_to date;

update public.cash_bank_ins
set
  cash_month = coalesce(cash_month, date_trunc('month', cash_source_date)::date, date_trunc('month', bank_in_date)::date),
  cash_sales_from = coalesce(cash_sales_from, cash_source_date),
  cash_sales_to = coalesce(cash_sales_to, cash_source_date)
where cash_month is null
   or (cash_source_date is not null and (cash_sales_from is null or cash_sales_to is null));

create index if not exists cash_bank_ins_active_branch_source_date_idx
on public.cash_bank_ins (branch_id, cash_source_date desc)
where coalesce(is_void, false) = false;

create index if not exists cash_bank_ins_active_branch_cash_month_idx
on public.cash_bank_ins (branch_id, cash_month desc)
where coalesce(is_void, false) = false;
