-- =====================================================================
--  FX Forward Rate (FXF) — full schema (HTML-faithful)
-- =====================================================================

-- ── fx_forwards column extensions ──
alter table fx_forwards add column if not exists name              text;
alter table fx_forwards add column if not exists transaction_date  date;
alter table fx_forwards add column if not exists maturity_date     date;
alter table fx_forwards add column if not exists term_days         int;
alter table fx_forwards add column if not exists notional_amount_foreign numeric(18,2);
alter table fx_forwards add column if not exists conversion_date   date;
alter table fx_forwards add column if not exists amount_thb        numeric(18,2);          -- auto: notional × forward
alter table fx_forwards add column if not exists reference_transaction text;
alter table fx_forwards add column if not exists reference_tr_contract text;
alter table fx_forwards add column if not exists inactive          boolean default false;
alter table fx_forwards add column if not exists currency          text default 'USD';

-- Extend fxf_status enum
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'Approved' and enumtypid = (select oid from pg_type where typname = 'fxf_status')) then
    alter type fxf_status add value 'Approved';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Closed' and enumtypid = (select oid from pg_type where typname = 'fxf_status')) then
    alter type fxf_status add value 'Closed';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Cancelled' and enumtypid = (select oid from pg_type where typname = 'fxf_status')) then
    alter type fxf_status add value 'Cancelled';
  end if;
exception when undefined_object then null;
end$$;

-- ── fxf_fees (Fee Payment per period) ──
create table if not exists fxf_fees (
  id                    uuid primary key default uuid_generate_v4(),
  fxf_id                uuid not null references fx_forwards(id) on delete cascade,
  gl_date               date not null,
  spot_fee              numeric(18,2) not null default 0,
  cancellation_amendment_fee numeric(18,2) not null default 0,
  je_id                 uuid references journal_entries(id) on delete set null,
  remark                text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_fxf_fees_fxf on fxf_fees(fxf_id);

alter table fxf_fees enable row level security;
drop policy if exists "anon_all_fxf_fees" on fxf_fees;
create policy "anon_all_fxf_fees" on fxf_fees for all using (true) with check (true);

-- ── fxf_fair_values (Fair Value per accounting period) ──
create table if not exists fxf_fair_values (
  id                    uuid primary key default uuid_generate_v4(),
  fxf_id                uuid not null references fx_forwards(id) on delete cascade,
  accounting_period     date not null,
  fair_value            numeric(18,2) not null default 0,
  unrealized_gain_loss  numeric(18,2) not null default 0,
  je_id                 uuid references journal_entries(id) on delete set null,
  remark                text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_fxf_fv_fxf on fxf_fair_values(fxf_id, accounting_period);

alter table fxf_fair_values enable row level security;
drop policy if exists "anon_all_fxf_fv" on fxf_fair_values;
create policy "anon_all_fxf_fv" on fxf_fair_values for all using (true) with check (true);

-- ── fxf_documents + storage bucket ──
create table if not exists fxf_documents (
  id            uuid primary key default uuid_generate_v4(),
  fxf_id        uuid not null references fx_forwards(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_fxf_doc_fxf on fxf_documents(fxf_id);

alter table fxf_documents enable row level security;
drop policy if exists "anon_all_fxf_documents" on fxf_documents;
create policy "anon_all_fxf_documents" on fxf_documents for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('fxf-documents', 'fxf-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_fxf_docs" on storage.objects;
create policy "anon_all_fxf_docs" on storage.objects
  for all using (bucket_id = 'fxf-documents') with check (bucket_id = 'fxf-documents');
