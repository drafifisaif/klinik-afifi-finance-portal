-- Phase 10: opening balance verification and source reference fields.
-- Run after supabase/phase7-opening-balances.sql.

alter table public.opening_balances
  add column if not exists verification_status text not null default 'pending_review',
  add column if not exists source_reference text,
  add column if not exists source_notes text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

update public.opening_balances
set verification_status = 'pending_review'
where verification_status is null;

alter table public.opening_balances
  alter column verification_status set default 'pending_review',
  alter column verification_status set not null;

alter table public.opening_balances
  drop constraint if exists opening_balances_verification_status_check,
  add constraint opening_balances_verification_status_check
  check (verification_status in ('confirmed', 'estimated', 'pending_review'));
