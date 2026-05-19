-- =====================================================================
--  LG/BG full schema — extend to match master_agreement_v30.html
-- =====================================================================

-- Extend lg_status enum
do $$ begin
  alter type lg_status add value if not exists 'Approved';
exception when others then null; end $$;
do $$ begin
  alter type lg_status add value if not exists 'Expired';
exception when others then null; end $$;
do $$ begin
  alter type lg_status add value if not exists 'Roll Over';
exception when others then null; end $$;
do $$ begin
  alter type lg_status add value if not exists 'Terminated';
exception when others then null; end $$;

-- Add columns to letter_guarantees
alter table letter_guarantees add column if not exists name text;                 -- short label e.g. BGBBL001
alter table letter_guarantees add column if not exists value_date date;
alter table letter_guarantees add column if not exists prepaid boolean not null default false;
alter table letter_guarantees add column if not exists amount_foreign numeric(18, 2);
alter table letter_guarantees add column if not exists conversion_date date;
alter table letter_guarantees add column if not exists conversion_rate numeric(12, 6);
alter table letter_guarantees add column if not exists reference_contract text;
alter table letter_guarantees add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table letter_guarantees add column if not exists payment_cycle text;
alter table letter_guarantees add column if not exists payment_date date;
alter table letter_guarantees add column if not exists fee_amount numeric(18, 2);
alter table letter_guarantees add column if not exists rollover_parent_id uuid references letter_guarantees(id) on delete set null;

-- Storage bucket for LG documents
create table if not exists lg_documents (
  id            uuid primary key default uuid_generate_v4(),
  lg_id         uuid not null references letter_guarantees(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_lg_doc_lg on lg_documents(lg_id);

alter table lg_documents enable row level security;
drop policy if exists "anon_all_lg_documents" on lg_documents;
create policy "anon_all_lg_documents" on lg_documents for all using (true) with check (true);

insert into storage.buckets (id, name, public) values ('lg-documents', 'lg-documents', true) on conflict (id) do nothing;
drop policy if exists "anon_all_lg_docs" on storage.objects;
create policy "anon_all_lg_docs" on storage.objects
  for all using (bucket_id = 'lg-documents') with check (bucket_id = 'lg-documents');

-- Backfill name from lg_no for existing rows
update letter_guarantees set name = lg_no where name is null;
