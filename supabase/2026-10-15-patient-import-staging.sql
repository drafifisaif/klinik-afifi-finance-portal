-- Private, short-lived upload bucket for historical patient CSV imports.
-- Patient files are processed server-side and removed after import attempts.

insert into storage.buckets (id, name, public, file_size_limit)
values ('patient-import-staging', 'patient-import-staging', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Finance can upload own patient import staging files" on storage.objects;
create policy "Finance can upload own patient import staging files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'patient-import-staging'
  and public.current_user_role() in ('owner', 'finance')
  and (storage.foldername(name))[1] = auth.uid()::text
);
