alter table public.daily_sales
  drop constraint if exists daily_sales_branch_id_sale_date_key;

drop index if exists public.daily_sales_one_active_per_branch_date;
create unique index daily_sales_one_active_per_branch_date
on public.daily_sales (branch_id, sale_date)
where coalesce(is_void, false) = false;
