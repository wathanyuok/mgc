-- =====================================================================
--  Floor Plan — full schema (HTML-faithful)
--  Adds: name, transaction_date, maturity_date, term_days, amount,
--        netting_ap/ar, reference_contract, rollover_parent_id, inactive,
--        extends status enum, and fp_documents table + storage bucket
-- =====================================================================

-- ── floor_plans column extensions ──
alter table floor_plans add column if not exists name              text;
alter table floor_plans add column if not exists transaction_date  date;
alter table floor_plans add column if not exists maturity_date     date;
alter table floor_plans add column if not exists term_days         int;
alter table floor_plans add column if not exists amount            numeric(18,2) default 0;
alter table floor_plans add column if not exists netting_ap        boolean default true;
alter table floor_plans add column if not exists netting_ar        boolean default true;
alter table floor_plans add column if not exists reference_contract text;
alter table floor_plans add column if not exists rollover_parent_id uuid references floor_plans(id) on delete set null;
alter table floor_plans add column if not exists inactive          boolean default false;
alter table floor_plans add column if not exists currency          text default 'THB';

-- ── Extend fp_status enum to include HTML-faithful values ──
-- (Postgres won't drop enum values, so we add missing ones)
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'Approved' and enumtypid = (select oid from pg_type where typname = 'fp_status')) then
    alter type fp_status add value 'Approved';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Roll Over' and enumtypid = (select oid from pg_type where typname = 'fp_status')) then
    alter type fp_status add value 'Roll Over';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Repaid' and enumtypid = (select oid from pg_type where typname = 'fp_status')) then
    alter type fp_status add value 'Repaid';
  end if;
exception
  when undefined_object then
    -- enum not present; skip silently
    null;
end$$;

-- ── fp_chassis column extensions (HTML-faithful) ──
alter table fp_chassis add column if not exists original_location text;
alter table fp_chassis add column if not exists current_location  text;
alter table fp_chassis add column if not exists location_modified_at date;

-- ── fp_documents (parallel to lg_documents / pn_documents) ──
create table if not exists fp_documents (
  id            uuid primary key default uuid_generate_v4(),
  fp_id         uuid not null references floor_plans(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_fp_doc_fp on fp_documents(fp_id);

alter table fp_documents enable row level security;
drop policy if exists "anon_all_fp_documents" on fp_documents;
create policy "anon_all_fp_documents" on fp_documents for all using (true) with check (true);

-- ── Storage bucket ──
insert into storage.buckets (id, name, public)
values ('fp-documents', 'fp-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_fp_docs" on storage.objects;
create policy "anon_all_fp_docs" on storage.objects
  for all using (bucket_id = 'fp-documents') with check (bucket_id = 'fp-documents');
