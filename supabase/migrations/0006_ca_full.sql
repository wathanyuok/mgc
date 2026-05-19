-- =====================================================================
--  CA — extend columns + sub-tables to match HTML view-ca
-- =====================================================================

-- Extend ca_status to include 'Terminated' (HTML uses Terminated)
do $$ begin
  alter type ca_status add value if not exists 'Terminated';
exception when others then null; end $$;

-- Extend credit_agreements columns
alter table credit_agreements add column if not exists finance_institution text;
alter table credit_agreements add column if not exists currency             text not null default 'THB';
alter table credit_agreements add column if not exists credit_line_foreign  numeric(18,2);
alter table credit_agreements add column if not exists fx_rate              numeric(12,6);
alter table credit_agreements add column if not exists fx_rate_date         date;
alter table credit_agreements add column if not exists credit_type          text not null default 'Revolving';   -- Revolving / Non Revolving
alter table credit_agreements add column if not exists rollover_max_days    int;
alter table credit_agreements add column if not exists rollover_max_times   int;
alter table credit_agreements add column if not exists conversion_date      date;
alter table credit_agreements add column if not exists conversion_rate      numeric(12,6);
alter table credit_agreements add column if not exists loan_purpose         text;
alter table credit_agreements add column if not exists reference_contract   text;
alter table credit_agreements add column if not exists curtailment_option   boolean not null default false;
alter table credit_agreements add column if not exists remark               text;
alter table credit_agreements add column if not exists rate_cards           jsonb not null default '[]'::jsonb;
alter table credit_agreements add column if not exists acct_cards           jsonb not null default '[]'::jsonb;

-- Sub-tables
create table if not exists ca_conditions (
  ca_id            uuid primary key references credit_agreements(id) on delete cascade,
  de_op            text default '<=',
  de_value         numeric(8, 2),
  dscr_op          text default '>=',
  dscr_value       numeric(8, 2),
  other_requirement text,
  consent_waiver   text
);

create table if not exists ca_collaterals (
  id          uuid primary key default uuid_generate_v4(),
  ca_id       uuid not null references credit_agreements(id) on delete cascade,
  type        text not null,
  fields      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ca_col_ca on ca_collaterals(ca_id);

create table if not exists ca_guarantors (
  id          uuid primary key default uuid_generate_v4(),
  ca_id       uuid not null references credit_agreements(id) on delete cascade,
  type        text not null,
  fields      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ca_guar_ca on ca_guarantors(ca_id);

create table if not exists ca_documents (
  id            uuid primary key default uuid_generate_v4(),
  ca_id         uuid not null references credit_agreements(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_ca_doc_ca on ca_documents(ca_id);

-- RLS
do $$ declare t text;
begin
  for t in select unnest(array['ca_conditions','ca_collaterals','ca_guarantors','ca_documents'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%I" on %I', t, t);
    execute format('create policy "anon_all_%I" on %I for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- Storage bucket for CA documents
insert into storage.buckets (id, name, public)
values ('ca-documents', 'ca-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_upload_ca_docs" on storage.objects;
drop policy if exists "anon_read_ca_docs"   on storage.objects;
drop policy if exists "anon_delete_ca_docs" on storage.objects;
create policy "anon_upload_ca_docs" on storage.objects for insert with check (bucket_id = 'ca-documents');
create policy "anon_read_ca_docs"   on storage.objects for select using (bucket_id = 'ca-documents');
create policy "anon_delete_ca_docs" on storage.objects for delete using (bucket_id = 'ca-documents');

-- Backfill: set finance_institution = 'KBANK' for existing rows where null
update credit_agreements set finance_institution = 'KBANK' where finance_institution is null;
