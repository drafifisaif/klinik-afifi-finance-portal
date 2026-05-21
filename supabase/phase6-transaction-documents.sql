-- Phase 6: optional supporting documents for finance transactions.
-- Run after supabase/phase5-controlled-edit-void-system.sql.

create table if not exists public.transaction_documents (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null check (
    entity_name in (
      'expenses',
      'supplier_purchases',
      'supplier_payments',
      'cash_bank_ins',
      'panel_claims',
      'panel_payments',
      'bank_transactions',
      'petty_cash_transactions'
    )
  ),
  entity_id uuid not null,
  branch_id uuid references public.branches(id) on delete set null,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  document_type text,
  file_name text not null,
  file_path text not null unique,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),
  compressed_size_bytes integer check (compressed_size_bytes is null or compressed_size_bytes >= 0),
  mime_type text,
  notes text,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  check (
    deleted_at is null
    or (deleted_by is not null and nullif(btrim(delete_reason), '') is not null)
  )
);

create index if not exists transaction_documents_entity_idx
on public.transaction_documents (entity_name, entity_id, created_at desc)
where deleted_at is null;

create index if not exists transaction_documents_branch_idx
on public.transaction_documents (branch_id, created_at desc)
where deleted_at is null and branch_id is not null;

create index if not exists transaction_documents_bank_idx
on public.transaction_documents (bank_account_id, created_at desc)
where deleted_at is null and bank_account_id is not null;

alter table public.transaction_documents enable row level security;

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
    )
$$;

drop policy if exists "Transaction document records follow source access" on public.transaction_documents;
create policy "Transaction document records follow source access"
on public.transaction_documents for select
to authenticated
using (
  deleted_at is null
  and public.can_access_transaction_document(entity_name, entity_id, 'view')
);

drop policy if exists "Allowed users can upload transaction documents" on public.transaction_documents;
create policy "Allowed users can upload transaction documents"
on public.transaction_documents for insert
to authenticated
with check (
  deleted_at is null
  and uploaded_by = auth.uid()
  and public.can_access_transaction_document(entity_name, entity_id, 'upload')
);

drop policy if exists "Allowed managers can soft delete transaction documents" on public.transaction_documents;
create policy "Allowed managers can soft delete transaction documents"
on public.transaction_documents for update
to authenticated
using (
  deleted_at is null
  and public.can_access_transaction_document(entity_name, entity_id, 'delete')
)
with check (
  public.can_access_transaction_document(entity_name, entity_id, 'delete')
);

insert into storage.buckets (id, name, public)
values ('finance-documents', 'finance-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "Allowed users can upload transaction document files" on storage.objects;
create policy "Allowed users can upload transaction document files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'finance-documents'
  and public.current_user_role() in ('owner', 'admin', 'finance', 'branch_pic')
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Transaction document files follow document access" on storage.objects;
create policy "Transaction document files follow document access"
on storage.objects for select
to authenticated
using (
  bucket_id = 'finance-documents'
  and exists (
    select 1
    from public.transaction_documents d
    where d.file_path = name
      and d.deleted_at is null
      and public.can_access_transaction_document(d.entity_name, d.entity_id, 'view')
  )
);

create or replace function public.log_audit_event(
  p_action text,
  p_entity_name text,
  p_entity_id uuid default null,
  p_branch_id uuid default null,
  p_bank_account_id uuid default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_changed_fields jsonb default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Audit event actor must be authenticated.';
  end if;

  if p_action not in (
    'create',
    'update',
    'void',
    'delete',
    'document_upload',
    'document_delete',
    'role_change',
    'permission_change'
  ) then
    raise exception 'Unsupported audit action: %', p_action;
  end if;

  insert into public.audit_events (
    actor_id,
    actor_email,
    action,
    entity_name,
    entity_id,
    branch_id,
    bank_account_id,
    before_data,
    after_data,
    changed_fields,
    description
  )
  values (
    auth.uid(),
    nullif(auth.jwt()->>'email', ''),
    p_action,
    p_entity_name,
    p_entity_id,
    p_branch_id,
    p_bank_account_id,
    p_before_data,
    p_after_data,
    p_changed_fields,
    p_description
  )
  returning id into event_id;

  return event_id;
end;
$$;
