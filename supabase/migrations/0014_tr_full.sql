-- =====================================================================
--  Trust Receipt (T/R) — full schema (HTML-faithful)
-- =====================================================================

-- ── trust_receipts column extensions ──
alter table trust_receipts add column if not exists name              text;
alter table trust_receipts add column if not exists transaction_date  date;
alter table trust_receipts add column if not exists maturity_date     date;
alter table trust_receipts add column if not exists amount_foreign    numeric(18,2);
alter table trust_receipts add column if not exists conversion_date   date;
alter table trust_receipts add column if not exists conversion_rate   numeric(12,6);
alter table trust_receipts add column if not exists reference_contract text;
alter table trust_receipts add column if not exists rollover_parent_id uuid references trust_receipts(id) on delete set null;
alter table trust_receipts add column if not exists inactive          boolean default false;

-- Extend tr_status enum
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'Approved' and enumtypid = (select oid from pg_type where typname = 'tr_status')) then
    alter type tr_status add value 'Approved';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Roll Over' and enumtypid = (select oid from pg_type where typname = 'tr_status')) then
    alter type tr_status add value 'Roll Over';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Closed' and enumtypid = (select oid from pg_type where typname = 'tr_status')) then
    alter type tr_status add value 'Closed';
  end if;
exception when undefined_object then null;
end$$;

-- ── tr_imported_goods (sub-table for B/L / import reference) ──
create table if not exists tr_imported_goods (
  id            uuid primary key default uuid_generate_v4(),
  tr_id         uuid not null references trust_receipts(id) on delete cascade,
  reference_no  text not null,                  -- INV-IMP-2023-0421
  description   text,                            -- Auto parts (BMW Series)
  vendor        text,                            -- BMW (Thailand) Co., Ltd.
  amount_foreign numeric(18,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_tr_goods_tr on tr_imported_goods(tr_id);

alter table tr_imported_goods enable row level security;
drop policy if exists "anon_all_tr_goods" on tr_imported_goods;
create policy "anon_all_tr_goods" on tr_imported_goods for all using (true) with check (true);

-- ── tr_documents + storage bucket ──
create table if not exists tr_documents (
  id            uuid primary key default uuid_generate_v4(),
  tr_id         uuid not null references trust_receipts(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_tr_doc_tr on tr_documents(tr_id);

alter table tr_documents enable row level security;
drop policy if exists "anon_all_tr_documents" on tr_documents;
create policy "anon_all_tr_documents" on tr_documents for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('tr-documents', 'tr-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_tr_docs" on storage.objects;
create policy "anon_all_tr_docs" on storage.objects
  for all using (bucket_id = 'tr-documents') with check (bucket_id = 'tr-documents');
