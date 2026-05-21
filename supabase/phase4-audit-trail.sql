-- Phase 4: owner-only audit trail for sensitive access and finance changes.
-- Run after supabase/phase3-petty-cash-tracking.sql.

alter table public.audit_events
  add column if not exists actor_email text,
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists changed_fields jsonb,
  add column if not exists description text;

create index if not exists audit_events_created_at_idx
on public.audit_events (created_at desc);

create index if not exists audit_events_actor_id_idx
on public.audit_events (actor_id, created_at desc);

create index if not exists audit_events_entity_idx
on public.audit_events (entity_name, action, created_at desc);

create index if not exists audit_events_branch_id_idx
on public.audit_events (branch_id, created_at desc)
where branch_id is not null;

create index if not exists audit_events_bank_account_id_idx
on public.audit_events (bank_account_id, created_at desc)
where bank_account_id is not null;

drop policy if exists "Management can read audit events" on public.audit_events;
drop policy if exists "Owner can read audit events" on public.audit_events;
create policy "Owner can read audit events"
on public.audit_events for select
to authenticated
using (public.current_user_role() = 'owner');

revoke insert, update, delete on public.audit_events from authenticated;

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

  if p_action not in ('create', 'update', 'delete', 'role_change', 'permission_change') then
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

revoke all on function public.log_audit_event(
  text,
  text,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text
) from public;

grant execute on function public.log_audit_event(
  text,
  text,
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text
) to authenticated;
