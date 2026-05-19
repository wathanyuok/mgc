-- =====================================================================
--  MA: Storage bucket + storage_path column for ma_documents
-- =====================================================================

-- Add storage_path to track Supabase Storage file path
alter table ma_documents add column if not exists storage_path text;

-- Create storage bucket (public read for prototype; tighten with RLS later)
insert into storage.buckets (id, name, public)
values ('ma-documents', 'ma-documents', true)
on conflict (id) do nothing;

-- Storage policies — allow anon to upload + read for prototype
drop policy if exists "anon_upload_ma_docs" on storage.objects;
drop policy if exists "anon_read_ma_docs"   on storage.objects;
drop policy if exists "anon_delete_ma_docs" on storage.objects;

create policy "anon_upload_ma_docs" on storage.objects
  for insert with check (bucket_id = 'ma-documents');

create policy "anon_read_ma_docs" on storage.objects
  for select using (bucket_id = 'ma-documents');

create policy "anon_delete_ma_docs" on storage.objects
  for delete using (bucket_id = 'ma-documents');
