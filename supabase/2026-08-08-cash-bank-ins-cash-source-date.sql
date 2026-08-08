-- Distinguish cash-control attribution date from actual bank deposit date.
-- bank_in_date remains the actual date money entered the bank.
-- cash_source_date is the branch cash period/date that the banked cash belongs to.

alter table public.cash_bank_ins
  add column if not exists cash_source_date date;

create index if not exists cash_bank_ins_active_branch_source_date_idx
on public.cash_bank_ins (branch_id, cash_source_date desc)
where coalesce(is_void, false) = false;
