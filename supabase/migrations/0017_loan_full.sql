-- =====================================================================
--  Loan — full schema (HTML-faithful)
-- =====================================================================

-- ── loans column extensions ──
alter table loans add column if not exists name                    text;
alter table loans add column if not exists transaction_date        date;
alter table loans add column if not exists amount                  numeric(18,2);   -- alias of principal
alter table loans add column if not exists amount_foreign          numeric(18,2);
alter table loans add column if not exists conversion_date         date;
alter table loans add column if not exists conversion_rate         numeric(12,6);
alter table loans add column if not exists currency                text default 'THB';

-- Schedule Information
alter table loans add column if not exists installment_start_date  date;
alter table loans add column if not exists installment_end_date    date;
alter table loans add column if not exists pay_eom                 boolean default true;
alter table loans add column if not exists payment_type            text default 'Fix Installment';
alter table loans add column if not exists installment             numeric(18,2);
alter table loans add column if not exists residual_value          numeric(18,2) default 0;
alter table loans add column if not exists include_rv_in_installment boolean default true;
alter table loans add column if not exists balloon_option          text;
alter table loans add column if not exists effective_rate          numeric(7,4);
alter table loans add column if not exists irr_month               numeric(8,4);

-- Prepayment
alter table loans add column if not exists allow_prepayment        text default 'Yes';
alter table loans add column if not exists prepayment_fee_base     text default 'Outstanding Principal';

-- Common
alter table loans add column if not exists rollover_parent_id      uuid references loans(id) on delete set null;
alter table loans add column if not exists inactive                boolean default false;
alter table loans add column if not exists rate_cards              jsonb not null default '[]'::jsonb;
alter table loans add column if not exists acct_cards              jsonb not null default '[]'::jsonb;

-- Extend loan_status enum
do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'Approved' and enumtypid = (select oid from pg_type where typname = 'loan_status')) then
    alter type loan_status add value 'Approved';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Rejected' and enumtypid = (select oid from pg_type where typname = 'loan_status')) then
    alter type loan_status add value 'Rejected';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'Cancelled' and enumtypid = (select oid from pg_type where typname = 'loan_status')) then
    alter type loan_status add value 'Cancelled';
  end if;
exception when undefined_object then null;
end$$;

-- ── loan_chassis (sub-table — Loan can be backed by vehicles) ──
create table if not exists loan_chassis (
  id            uuid primary key default uuid_generate_v4(),
  loan_id       uuid not null references loans(id) on delete cascade,
  chassis_no    text not null,
  car_model     text,
  location      text,
  cost          numeric(18,2) not null default 0,
  status        text default 'Active',
  sort_order    int not null default 0
);
create index if not exists idx_loan_chassis_loan on loan_chassis(loan_id);
alter table loan_chassis enable row level security;
drop policy if exists "anon_all_loan_chassis" on loan_chassis;
create policy "anon_all_loan_chassis" on loan_chassis for all using (true) with check (true);

-- ── loan_documents + storage bucket ──
create table if not exists loan_documents (
  id            uuid primary key default uuid_generate_v4(),
  loan_id       uuid not null references loans(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_loan_doc_loan on loan_documents(loan_id);
alter table loan_documents enable row level security;
drop policy if exists "anon_all_loan_documents" on loan_documents;
create policy "anon_all_loan_documents" on loan_documents for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('loan-documents', 'loan-documents', true)
on conflict (id) do nothing;

drop policy if exists "anon_all_loan_docs" on storage.objects;
create policy "anon_all_loan_docs" on storage.objects
  for all using (bucket_id = 'loan-documents') with check (bucket_id = 'loan-documents');
