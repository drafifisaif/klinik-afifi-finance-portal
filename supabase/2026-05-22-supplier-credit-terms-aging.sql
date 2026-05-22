alter table public.suppliers
  add column if not exists default_credit_term_days integer;

update public.suppliers
set default_credit_term_days = payment_terms_days
where default_credit_term_days is null;

alter table public.suppliers
  alter column default_credit_term_days set default 30;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'suppliers_default_credit_term_days_check'
  ) then
    alter table public.suppliers
      add constraint suppliers_default_credit_term_days_check
      check (default_credit_term_days >= 0);
  end if;
end $$;

alter table public.supplier_purchases
  add column if not exists invoice_date date,
  add column if not exists credit_term_days integer,
  add column if not exists payment_status text default 'unpaid';

update public.supplier_purchases p
set
  invoice_date = coalesce(invoice_date, purchase_date),
  credit_term_days = coalesce(
    credit_term_days,
    (select coalesce(s.default_credit_term_days, s.payment_terms_days, 30) from public.suppliers s where s.id = p.supplier_id),
    30
  );

create or replace function public.apply_supplier_purchase_terms()
returns trigger
language plpgsql
as $$
declare
  supplier_default_term integer;
begin
  select coalesce(default_credit_term_days, payment_terms_days, 30)
  into supplier_default_term
  from public.suppliers
  where id = new.supplier_id;

  new.invoice_date := coalesce(new.invoice_date, new.purchase_date, current_date);
  new.credit_term_days := coalesce(new.credit_term_days, supplier_default_term, 30);
  new.purchase_date := new.invoice_date;
  new.due_date := new.invoice_date + coalesce(new.credit_term_days, 0);
  new.payment_status := coalesce(new.payment_status, 'unpaid');

  return new;
end;
$$;

drop trigger if exists trg_apply_supplier_purchase_terms on public.supplier_purchases;
create trigger trg_apply_supplier_purchase_terms
before insert or update of supplier_id, invoice_date, purchase_date, credit_term_days
on public.supplier_purchases
for each row
execute function public.apply_supplier_purchase_terms();

create or replace function public.refresh_supplier_purchase_payment_status(target_purchase_id uuid)
returns void
language plpgsql
as $$
declare
  total_paid numeric(12,2);
  total_invoice numeric(12,2);
  due_date_value date;
  next_status text;
  previous_status text;
begin
  select total_amount, due_date, payment_status
    into total_invoice, due_date_value, previous_status
  from public.supplier_purchases
  where id = target_purchase_id;

  if total_invoice is null then
    return;
  end if;

  select coalesce(sum(amount), 0)
    into total_paid
  from public.supplier_payments
  where purchase_id = target_purchase_id;

  if total_paid >= total_invoice then
    next_status := 'paid';
  elsif total_paid > 0 then
    next_status := 'partially_paid';
  elsif due_date_value is not null and current_date > due_date_value then
    next_status := 'overdue';
  else
    next_status := 'unpaid';
  end if;

  update public.supplier_purchases
  set payment_status = next_status
  where id = target_purchase_id;

  if previous_status is distinct from next_status then
    insert into public.audit_events (entity_name, entity_id, action, details)
    values (
      'supplier_purchases',
      target_purchase_id,
      'update',
      jsonb_build_object(
        'description', 'Supplier purchase payment status changed',
        'before_data', jsonb_build_object('payment_status', previous_status),
        'after_data', jsonb_build_object('payment_status', next_status),
        'changed_fields', jsonb_build_array('payment_status')
      )
    );
  end if;
end;
$$;

create or replace function public.refresh_supplier_purchase_payment_status_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'supplier_payments' then
    if tg_op = 'DELETE' then
      if old.purchase_id is not null then
        perform public.refresh_supplier_purchase_payment_status(old.purchase_id);
      end if;
      return old;
    end if;

    if new.purchase_id is not null then
      perform public.refresh_supplier_purchase_payment_status(new.purchase_id);
    end if;
    if tg_op = 'UPDATE' and old.purchase_id is distinct from new.purchase_id and old.purchase_id is not null then
      perform public.refresh_supplier_purchase_payment_status(old.purchase_id);
    end if;
    return new;
  end if;

  perform public.refresh_supplier_purchase_payment_status(new.id);
  return new;
end;
$$;

drop trigger if exists trg_refresh_supplier_purchase_status_from_payments on public.supplier_payments;
create trigger trg_refresh_supplier_purchase_status_from_payments
after insert or update or delete on public.supplier_payments
for each row
execute function public.refresh_supplier_purchase_payment_status_trigger();

drop trigger if exists trg_refresh_supplier_purchase_status_from_purchase on public.supplier_purchases;
create trigger trg_refresh_supplier_purchase_status_from_purchase
after insert or update of total_amount, due_date, credit_term_days, invoice_date on public.supplier_purchases
for each row
execute function public.refresh_supplier_purchase_payment_status_trigger();

update public.supplier_purchases p
set due_date = p.invoice_date + coalesce(p.credit_term_days, 0);

do $$
declare
  row_record record;
begin
  for row_record in select id from public.supplier_purchases loop
    perform public.refresh_supplier_purchase_payment_status(row_record.id);
  end loop;
end $$;

create or replace function public.audit_supplier_credit_terms()
returns trigger
language plpgsql
as $$
begin
  if old.default_credit_term_days is distinct from new.default_credit_term_days then
    insert into public.audit_events (actor_id, entity_name, entity_id, action, details)
    values (
      auth.uid(),
      'suppliers',
      new.id,
      'update',
      jsonb_build_object(
        'description', 'Supplier credit term changed',
        'before_data', jsonb_build_object('default_credit_term_days', old.default_credit_term_days),
        'after_data', jsonb_build_object('default_credit_term_days', new.default_credit_term_days),
        'changed_fields', jsonb_build_array('default_credit_term_days')
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_supplier_credit_terms on public.suppliers;
create trigger trg_audit_supplier_credit_terms
after update of default_credit_term_days on public.suppliers
for each row
execute function public.audit_supplier_credit_terms();

create or replace function public.audit_supplier_purchase_due_fields()
returns trigger
language plpgsql
as $$
begin
  if old.credit_term_days is distinct from new.credit_term_days
    or old.due_date is distinct from new.due_date
    or old.invoice_date is distinct from new.invoice_date then
    insert into public.audit_events (actor_id, entity_name, entity_id, action, details)
    values (
      auth.uid(),
      'supplier_purchases',
      new.id,
      'update',
      jsonb_build_object(
        'description', 'Supplier purchase credit term or due date changed',
        'before_data', jsonb_build_object(
          'invoice_date', old.invoice_date,
          'credit_term_days', old.credit_term_days,
          'due_date', old.due_date
        ),
        'after_data', jsonb_build_object(
          'invoice_date', new.invoice_date,
          'credit_term_days', new.credit_term_days,
          'due_date', new.due_date
        ),
        'changed_fields', jsonb_build_array('invoice_date', 'credit_term_days', 'due_date')
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_supplier_purchase_due_fields on public.supplier_purchases;
create trigger trg_audit_supplier_purchase_due_fields
after update of invoice_date, credit_term_days, due_date on public.supplier_purchases
for each row
execute function public.audit_supplier_purchase_due_fields();

create or replace function public.audit_supplier_payment_link()
returns trigger
language plpgsql
as $$
begin
  if new.purchase_id is not null then
    insert into public.audit_events (actor_id, entity_name, entity_id, action, details)
    values (
      auth.uid(),
      'supplier_payments',
      new.id,
      case when tg_op = 'INSERT' then 'create' else 'update' end,
      jsonb_build_object(
        'description', 'Supplier payment linked to invoice',
        'before_data', case when tg_op = 'UPDATE' then jsonb_build_object('purchase_id', old.purchase_id) else null end,
        'after_data', jsonb_build_object('purchase_id', new.purchase_id, 'amount', new.amount),
        'changed_fields', jsonb_build_array('purchase_id', 'amount')
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_supplier_payment_link on public.supplier_payments;
create trigger trg_audit_supplier_payment_link
after insert or update of purchase_id, amount on public.supplier_payments
for each row
execute function public.audit_supplier_payment_link();

drop view if exists public.v_supplier_outstanding;

create view public.v_supplier_outstanding
with (security_invoker = on) as
select
  p.id as purchase_id,
  p.supplier_id,
  s.name as supplier_name,
  p.branch_id,
  b.name as branch_name,
  p.invoice_no,
  p.invoice_date,
  p.purchase_date,
  p.credit_term_days,
  p.due_date,
  p.total_amount,
  coalesce(sum(pay.amount), 0) as paid_amount,
  p.total_amount - coalesce(sum(pay.amount), 0) as outstanding_amount,
  case
    when p.total_amount - coalesce(sum(pay.amount), 0) <= 0 then 'paid'
    when coalesce(sum(pay.amount), 0) > 0 then 'partially_paid'
    when p.due_date is not null and p.due_date < current_date then 'overdue'
    else 'unpaid'
  end as status,
  case
    when p.total_amount - coalesce(sum(pay.amount), 0) <= 0 then 'paid'
    when coalesce(sum(pay.amount), 0) > 0 then 'partially_paid'
    when p.due_date is not null and p.due_date < current_date then 'overdue'
    else 'unpaid'
  end as payment_status,
  case
    when p.total_amount - coalesce(sum(pay.amount), 0) <= 0 then 'paid'
    when p.due_date is null then 'not_due'
    when current_date <= p.due_date then 'not_due'
    when current_date - p.due_date <= 30 then 'due_within_30'
    when current_date - p.due_date <= 60 then 'overdue_31_60'
    when current_date - p.due_date <= 90 then 'overdue_61_90'
    else 'over_90'
  end as aging_bucket,
  greatest(current_date - p.due_date, 0) as days_overdue
from public.supplier_purchases p
join public.suppliers s on s.id = p.supplier_id
join public.branches b on b.id = p.branch_id
left join public.supplier_payments pay on pay.purchase_id = p.id
group by p.id, p.supplier_id, s.name, p.branch_id, b.name;
