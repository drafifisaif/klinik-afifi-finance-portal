alter table public.panel_claims
  add column if not exists is_void boolean not null default false,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null;

create index if not exists panel_claims_is_void_idx
on public.panel_claims (is_void);

drop policy if exists "Branch scoped panel claims update" on public.panel_claims;
create policy "Branch scoped panel claims update"
on public.panel_claims for update
to authenticated
using (public.can_access_branch(branch_id))
with check (public.can_access_branch(branch_id));

drop policy if exists "Finance can update panel payments" on public.panel_payments;
create policy "Finance can update panel payments"
on public.panel_payments for update
to authenticated
using (
  public.current_user_role() in ('owner', 'admin', 'finance')
  and exists (
    select 1
    from public.panel_claims c
    where c.id = panel_claim_id
      and public.can_access_branch(c.branch_id)
  )
)
with check (
  public.current_user_role() in ('owner', 'admin', 'finance')
  and exists (
    select 1
    from public.panel_claims c
    where c.id = panel_claim_id
      and public.can_access_branch(c.branch_id)
  )
);

notify pgrst, 'reload schema';
