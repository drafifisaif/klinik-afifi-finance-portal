-- Payroll expenses use the existing expense ledger so dashboard and reports
-- continue to follow expense_date for accounting and cash-flow periods.
alter type public.expense_category add value if not exists 'kwsp';
alter type public.expense_category add value if not exists 'socso';
alter type public.expense_category add value if not exists 'eis';
alter type public.expense_category add value if not exists 'other_payroll';

alter table public.expenses
  add column if not exists payroll_month date;

alter table public.expenses
  drop constraint if exists expenses_payroll_month_first_day_check,
  add constraint expenses_payroll_month_first_day_check
    check (payroll_month is null or payroll_month = date_trunc('month', payroll_month)::date);

create index if not exists expenses_payroll_month_branch_idx
  on public.expenses (payroll_month, branch_id)
  where payroll_month is not null and not is_void;

drop policy if exists "Branch scoped expenses read" on public.expenses;
create policy "Branch scoped expenses read"
on public.expenses for select
to authenticated
using (
  public.can_access_branch(branch_id)
  and (
    category::text not in ('salary', 'kwsp', 'socso', 'eis', 'other_payroll')
    or public.current_user_role() in ('owner', 'finance')
  )
);

drop policy if exists "Branch scoped expenses write" on public.expenses;
create policy "Branch scoped expenses write"
on public.expenses for insert
to authenticated
with check (
  public.can_access_branch(branch_id)
  and (
    category::text not in ('salary', 'kwsp', 'socso', 'eis', 'other_payroll')
    or public.current_user_role() in ('owner', 'finance')
  )
);

drop policy if exists "Finance can update expenses" on public.expenses;
create policy "Finance can update expenses"
on public.expenses for update
to authenticated
using (
  public.can_access_branch(branch_id)
  and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic')
  and (public.current_user_role() = 'owner' or not is_void)
  and (
    category::text not in ('salary', 'kwsp', 'socso', 'eis', 'other_payroll')
    or public.current_user_role() in ('owner', 'finance')
  )
)
with check (
  public.can_access_branch(branch_id)
  and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic')
  and (
    category::text not in ('salary', 'kwsp', 'socso', 'eis', 'other_payroll')
    or public.current_user_role() in ('owner', 'finance')
  )
);
