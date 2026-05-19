-- =====================================================================
--  P/N Documents — table + storage bucket
-- =====================================================================

create table if not exists pn_documents (
  id            uuid primary key default uuid_generate_v4(),
  pn_id         uuid not null references promissory_notes(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_pn_doc_pn on pn_documents(pn_id);

alter table pn_documents enable row level security;
drop policy if exists "anon_all_pn_documents" on pn_documents;
create policy "anon_all_pn_documents" on pn_documents for all using (true) with check (true);

-- Storage bucket (create via dashboard if this fails)
insert into storage.buckets (id, name, public)
values ('pn-documents', 'pn-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_pn_docs" on storage.objects;
create policy "anon_all_pn_docs" on storage.objects
  for all using (bucket_id = 'pn-documents') with check (bucket_id = 'pn-documents');
