alter table public.transaction_documents
drop constraint if exists transaction_documents_entity_name_check;

alter table public.transaction_documents
add constraint transaction_documents_entity_name_check
check (
  entity_name in (
    'expenses',
    'supplier_purchases',
    'supplier_purchase_entries',
    'supplier_payments',
    'supplier_payment_entries',
    'cash_bank_ins',
    'panel_claims',
    'panel_payments',
    'bank_transactions',
    'petty_cash_transactions'
  )
);

create or replace function public.can_access_transaction_document(
  target_entity_name text,
  target_entity_id uuid,
  access_mode text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() in ('admin', 'finance', 'branch_pic')
      and access_mode in ('view', 'upload', 'delete')
      and (
        (
          target_entity_name = 'expenses'
          and exists (
            select 1
            from public.expenses e
            where e.id = target_entity_id
              and public.can_access_branch(e.branch_id)
          )
        )
        or (
          target_entity_name = 'supplier_purchases'
          and exists (
            select 1
            from public.supplier_purchases p
            where p.id = target_entity_id
              and public.can_access_branch(p.branch_id)
          )
        )
        or (
          target_entity_name = 'supplier_purchase_entries'
          and exists (
            select 1
            from public.supplier_purchase_entries p
            where p.id = target_entity_id
              and public.can_access_branch(p.branch_id)
          )
        )
        or (
          target_entity_name = 'supplier_payments'
          and exists (
            select 1
            from public.supplier_payments p
            where p.id = target_entity_id
              and (
                public.is_management()
                or (p.branch_id is not null and public.can_access_branch(p.branch_id))
              )
          )
        )
        or (
          target_entity_name = 'supplier_payment_entries'
          and exists (
            select 1
            from public.supplier_payment_entries p
            where p.id = target_entity_id
              and public.can_access_branch(p.branch_id)
          )
        )
        or (
          target_entity_name = 'panel_claims'
          and exists (
            select 1
            from public.panel_claims c
            where c.id = target_entity_id
              and public.can_access_branch(c.branch_id)
          )
        )
        or (
          target_entity_name = 'panel_payments'
          and exists (
            select 1
            from public.panel_payments pp
            join public.panel_claims c on c.id = pp.panel_claim_id
            where pp.id = target_entity_id
              and public.can_access_branch(c.branch_id)
          )
        )
        or (
          target_entity_name = 'cash_bank_ins'
          and exists (
            select 1
            from public.cash_bank_ins cbi
            where cbi.id = target_entity_id
              and (
                (
                  public.current_user_role() = 'branch_pic'
                  and cbi.branch_id = public.current_user_branch_id()
                )
                or (
                  public.current_user_role() in ('admin', 'finance')
                  and public.can_access_bank_account(cbi.bank_account_id, 'view')
                )
              )
          )
        )
        or (
          target_entity_name = 'bank_transactions'
          and exists (
            select 1
            from public.bank_transactions bt
            where bt.id = target_entity_id
              and public.can_access_manual_bank_account(bt.bank_account_id, 'view')
              and (
                public.current_user_role() <> 'branch_pic'
                or bt.branch_id = public.current_user_branch_id()
              )
          )
        )
        or (
          target_entity_name = 'petty_cash_transactions'
          and exists (
            select 1
            from public.petty_cash_transactions pct
            where pct.id = target_entity_id
              and public.can_access_branch(pct.branch_id)
          )
        )
      )
      and (
        access_mode <> 'delete'
        or public.current_user_role() in ('admin', 'finance')
      )
    );
$$;

notify pgrst, 'reload schema';
