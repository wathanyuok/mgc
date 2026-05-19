-- =====================================================================
--  Overdraft (O/D) — full schema (HTML-faithful)
--  Adds: name, transaction_date, amount, extends status enum,
--        + od_bank_transactions (daily ending balance)
--        + od_documents + storage bucket
-- =====================================================================

-- ── overdrafts column extensions ──
alter table overdrafts add column if not exists name              text;
alter table overdrafts add column if not exists transaction_date  date;
alter table overdrafts add column if not exists amount            numeric(18,2) default 0;
alter table overdrafts add column if not exists rollover_parent_id uuid references overdrafts(id) on delete set null;
alter table overdrafts add column if not exists inactive          boolean default false;
alter table overdrafts add column if not exists currency          text default 'THB';

-- Extend od_status enum
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'Approved' and enumtypid = (select oid from pg_type where typname = 'od_status')) then
    alter type od_status add value 'Approved';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Cancelled' and enumtypid = (select oid from pg_type where typname = 'od_status')) then
    alter type od_status add value 'Cancelled';
  end if;
exception
  when undefined_object then null;
end$$;

-- ── od_bank_transactions ── daily ending balance (Import / Manual)
create table if not exists od_bank_transactions (
  id            uuid primary key default uuid_generate_v4(),
  od_id         uuid not null references overdrafts(id) on delete cascade,
  tx_date       date not null,
  ending_balance numeric(18,2) not null default 0,       -- negative = OD utilized
  source        text not null default 'Manual',           -- Manual / Import
  last_modified timestamptz not null default now(),
  remark        text
);
create index if not exists idx_od_bank_od on od_bank_transactions(od_id, tx_date);

alter table od_bank_transactions enable row level security;
drop policy if exists "anon_all_od_bank_tx" on od_bank_transactions;
create policy "anon_all_od_bank_tx" on od_bank_transactions for all using (true) with check (true);

-- ── od_documents ──
create table if not exists od_documents (
  id            uuid primary key default uuid_generate_v4(),
  od_id         uuid not null references overdrafts(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_od_doc_od on od_documents(od_id);

alter table od_documents enable row level security;
drop policy if exists "anon_all_od_documents" on od_documents;
create policy "anon_all_od_documents" on od_documents for all using (true) with check (true);

-- ── Storage bucket ──
insert into storage.buckets (id, name, public)
values ('od-documents', 'od-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_od_docs" on storage.objects;
create policy "anon_all_od_docs" on storage.objects
  for all using (bucket_id = 'od-documents') with check (bucket_id = 'od-documents');
