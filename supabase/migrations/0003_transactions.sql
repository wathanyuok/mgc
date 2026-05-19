-- =====================================================================
--  TRANSACTIONS — P/N · LG/BG · Floor Plan · O/D · T/R · FX Forward · Loan · Repayment
-- =====================================================================

create extension if not exists "uuid-ossp";

-- Idempotent drops
drop table if exists repayments     cascade;
drop table if exists loan_schedules cascade;
drop table if exists loans          cascade;
drop table if exists fx_forwards    cascade;
drop table if exists trust_receipts cascade;
drop table if exists overdrafts     cascade;
drop table if exists fp_chassis     cascade;
drop table if exists floor_plans    cascade;
drop table if exists lg_fees        cascade;
drop table if exists letter_guarantees cascade;
drop table if exists promissory_notes  cascade;

drop type if exists pn_status cascade;
drop type if exists lg_status cascade;
drop type if exists fp_status cascade;
drop type if exists od_status cascade;
drop type if exists tr_status cascade;
drop type if exists fxf_status cascade;
drop type if exists loan_status cascade;
drop type if exists facility_type cascade;

create type facility_type as enum ('PN','LG','BG','FP','OD','TR','FXF','Loan','Lease','HP');

create type pn_status   as enum ('Draft','Approved','Roll Over','Repaid','Cancelled');
create type lg_status   as enum ('Draft','Active','Closed','Cancelled');
create type fp_status   as enum ('Draft','Active','Closed','Cancelled');
create type od_status   as enum ('Draft','Active','Suspended','Closed');
create type tr_status   as enum ('Draft','Active','Repaid','Cancelled');
create type fxf_status  as enum ('Draft','Active','Settled','Cancelled');
create type loan_status as enum ('Draft','Active','Closed','Modified');

-- =====================================================================
-- 1. Promissory Note (P/N)
-- =====================================================================
create table promissory_notes (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,                     -- PNWC002
  pn_number           text,                              -- P112245679
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  facility_type       facility_type not null default 'PN',
  transaction_date    date not null,
  maturity_date       date,
  term_days           int,
  amount              numeric(18,2) not null default 0,
  currency            text not null default 'THB',
  interest_rate_id    bigint references interest_rates(id) on delete set null,
  effective_rate      numeric(7,4),
  reference_contract  text,
  status              pn_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_pn_status on promissory_notes(status);
create index idx_pn_ca     on promissory_notes(ca_id);

-- =====================================================================
-- 2. Letter of Guarantee / Bank Guarantee (LG / BG)
-- =====================================================================
create table letter_guarantees (
  id                  uuid primary key default uuid_generate_v4(),
  lg_no               text not null unique,
  lg_type             text not null default 'LG',         -- LG / BG
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  beneficiary         text not null,
  subject             text,                               -- ค้ำสัญญาอะไร
  amount              numeric(18,2) not null default 0,
  currency            text not null default 'THB',
  issue_date          date not null,
  expiry_date         date not null,
  status              lg_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_lg_status on letter_guarantees(status);

-- LG/BG fee schedule
create table lg_fees (
  id            uuid primary key default uuid_generate_v4(),
  lg_id         uuid not null references letter_guarantees(id) on delete cascade,
  fee_date      date not null,
  description   text,
  rate_pct      numeric(7,4),
  amount        numeric(18,2) not null,
  paid          boolean not null default false,
  paid_date     date,
  sort_order    int not null default 0
);
create index idx_lg_fee_lg on lg_fees(lg_id);

-- =====================================================================
-- 3. Floor Plan + Chassis
-- =====================================================================
create table floor_plans (
  id                  uuid primary key default uuid_generate_v4(),
  fp_no               text not null unique,
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  vendor              text,
  schedule_mode       text not null default 'bmw',        -- bmw / other
  start_date          date not null,
  end_date            date,
  total_amount        numeric(18,2) not null default 0,
  used_amount         numeric(18,2) not null default 0,
  status              fp_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_fp_status on floor_plans(status);

create table fp_chassis (
  id            uuid primary key default uuid_generate_v4(),
  fp_id         uuid not null references floor_plans(id) on delete cascade,
  chassis_no    text not null,
  model         text,
  receive_date  date,
  amount        numeric(18,2) not null default 0,
  curtail_id    uuid,                                     -- references curtailments(id)
  status        text default 'In Stock',                  -- In Stock / Sold / Returned
  sort_order    int not null default 0
);
create index idx_chassis_fp on fp_chassis(fp_id);

-- =====================================================================
-- 4. Overdraft (O/D)
-- =====================================================================
create table overdrafts (
  id                  uuid primary key default uuid_generate_v4(),
  od_no               text not null unique,
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  facility_limit      numeric(18,2) not null default 0,
  used_amount         numeric(18,2) not null default 0,
  interest_rate_id    bigint references interest_rates(id) on delete set null,
  effective_rate      numeric(7,4),
  start_date          date not null,
  end_date            date,
  account_no          text,
  status              od_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_od_status on overdrafts(status);

-- =====================================================================
-- 5. Trust Receipt (T/R)
-- =====================================================================
create table trust_receipts (
  id                  uuid primary key default uuid_generate_v4(),
  tr_no               text not null unique,
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  supplier            text,
  invoice_no          text,
  invoice_date        date,
  due_date            date not null,
  term_days           int,
  amount              numeric(18,2) not null default 0,
  currency            text not null default 'THB',
  interest_rate_id    bigint references interest_rates(id) on delete set null,
  effective_rate      numeric(7,4),
  status              tr_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_tr_status on trust_receipts(status);

-- =====================================================================
-- 6. FX Forward
-- =====================================================================
create table fx_forwards (
  id                  uuid primary key default uuid_generate_v4(),
  fxf_no              text not null unique,
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  deal_date           date not null,
  value_date          date not null,                      -- settlement date
  direction           text not null default 'Buy',        -- Buy / Sell
  ccy_buy             text not null default 'USD',
  ccy_sell            text not null default 'THB',
  amount_buy          numeric(18,4) not null default 0,
  amount_sell         numeric(18,4) not null default 0,
  spot_rate           numeric(12,6),
  forward_rate        numeric(12,6) not null,
  swap_points         numeric(12,6),
  status              fxf_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_fxf_status on fx_forwards(status);

-- =====================================================================
-- 7. Loan (standalone term loan)
-- =====================================================================
create table loans (
  id                  uuid primary key default uuid_generate_v4(),
  loan_no             text not null unique,
  ca_id               uuid references credit_agreements(id) on delete set null,
  finance_institution text not null,
  principal           numeric(18,2) not null,
  annual_rate         numeric(7,4) not null,
  term_months         int not null,
  start_date          date not null,
  end_date            date,
  payment_freq        text not null default 'monthly',
  status              loan_status not null default 'Draft',
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_loan_status on loans(status);

create table loan_schedules (
  id            uuid primary key default uuid_generate_v4(),
  loan_id       uuid not null references loans(id) on delete cascade,
  period        int not null,
  due_date      date not null,
  begin_balance numeric(18,2) not null,
  payment       numeric(18,2) not null,
  interest      numeric(18,2) not null,
  principal     numeric(18,2) not null,
  end_balance   numeric(18,2) not null,
  paid          boolean not null default false,
  paid_date     date,
  created_at    timestamptz not null default now(),
  unique (loan_id, period)
);
create index idx_loan_sched on loan_schedules(loan_id);

-- =====================================================================
-- 8. Repayment (centralized journal)
-- =====================================================================
create table repayments (
  id              uuid primary key default uuid_generate_v4(),
  repayment_no    text not null unique,
  facility_type   facility_type not null,                 -- which kind
  facility_id     uuid not null,                          -- soft FK
  pay_date        date not null,
  amount          numeric(18,2) not null,
  principal       numeric(18,2) not null default 0,
  interest        numeric(18,2) not null default 0,
  fee             numeric(18,2) not null default 0,
  vat             numeric(18,2) not null default 0,
  wht             numeric(18,2) not null default 0,
  channel         text default 'Bank Statement',          -- Bank Stmt / AP / Cash
  reference_no    text,
  remark          text,
  status          text not null default 'Posted',         -- Draft / Posted / Reversed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_rep_facility on repayments(facility_type, facility_id);
create index idx_rep_date     on repayments(pay_date);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
do $$ declare t text;
begin
  for t in select unnest(array[
    'promissory_notes','letter_guarantees','floor_plans','overdrafts',
    'trust_receipts','fx_forwards','loans','repayments'])
  loop
    execute format('create trigger trg_%I_updated before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- =====================================================================
-- RLS open for prototype
-- =====================================================================
do $$ declare t text;
begin
  for t in select unnest(array[
    'promissory_notes','letter_guarantees','lg_fees','floor_plans','fp_chassis',
    'overdrafts','trust_receipts','fx_forwards','loans','loan_schedules','repayments'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%I" on %I', t, t);
    execute format('create policy "anon_all_%I" on %I for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- =====================================================================
-- Seed data
-- =====================================================================
insert into promissory_notes (name, pn_number, finance_institution, transaction_date, maturity_date, term_days, amount, currency, status)
values
  ('PNWC002', 'P112245679', 'KBANK', '2023-10-12', '2023-12-12', 60, 4050000, 'THB', 'Approved'),
  ('PNWC003', 'P112245680', 'KBANK', '2023-11-01', '2024-01-30', 90, 3000000, 'THB', 'Approved'),
  ('PNWC004', 'P112245681', 'SCB',   '2024-01-15', '2024-04-15', 90, 5000000, 'THB', 'Draft');

insert into letter_guarantees (lg_no, lg_type, finance_institution, beneficiary, subject, amount, issue_date, expiry_date, status)
values
  ('LG-2024-001', 'LG', 'KBANK', 'Department of Land Transport', 'ค้ำประกันป้ายแดง', 500000, '2024-01-01', '2024-12-31', 'Active'),
  ('BG-2024-001', 'BG', 'BBL',   'Customs Department',           'ค้ำประกันภาษีนำเข้า', 2000000, '2024-02-01', '2025-01-31', 'Active');

insert into floor_plans (fp_no, finance_institution, vendor, schedule_mode, start_date, end_date, total_amount, status)
values
  ('FP-2024-001', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'bmw',   '2024-01-01', '2024-12-31', 50000000, 'Active'),
  ('FP-2024-002', 'SCB',   'Honda Automobile',          'other', '2024-01-01', '2024-12-31', 30000000, 'Active');

insert into overdrafts (od_no, finance_institution, facility_limit, used_amount, start_date, end_date, account_no, status)
values
  ('OD-2024-001', 'KBANK', 10000000, 2500000, '2024-01-01', '2025-12-31', '123-4-56789-0', 'Active'),
  ('OD-2024-002', 'BBL',    5000000,       0, '2024-03-01', '2026-02-28', '987-6-54321-0', 'Active');

insert into trust_receipts (tr_no, finance_institution, supplier, invoice_no, invoice_date, due_date, term_days, amount, currency, status)
values
  ('TR-2024-001', 'KBANK', 'Honda Logistics', 'INV-2024-100', '2024-01-15', '2024-04-15', 90, 1500000, 'THB', 'Active'),
  ('TR-2024-002', 'SCB',   'Toyota Parts',     'INV-2024-205', '2024-02-10', '2024-05-10', 90, 2500000, 'THB', 'Repaid');

insert into fx_forwards (fxf_no, finance_institution, deal_date, value_date, direction, ccy_buy, ccy_sell, amount_buy, amount_sell, spot_rate, forward_rate, status)
values
  ('FXF-2024-001', 'KBANK', '2024-01-10', '2024-04-10', 'Buy', 'USD', 'THB', 100000, 3520000, 35.10, 35.20, 'Active'),
  ('FXF-2024-002', 'BBL',   '2024-02-15', '2024-08-15', 'Sell','EUR', 'THB', 50000,  1875000, 37.20, 37.50, 'Active');

insert into loans (loan_no, finance_institution, principal, annual_rate, term_months, start_date, end_date, status)
values
  ('LN-2024-001', 'KBANK', 10000000, 5.50, 60, '2024-01-01', '2028-12-31', 'Active'),
  ('LN-2024-002', 'BBL',   5000000,  5.25, 36, '2024-03-01', '2027-02-28', 'Active');

insert into repayments (repayment_no, facility_type, facility_id, pay_date, amount, principal, interest, channel, status)
select 'RP-2024-001', 'PN'::facility_type, id, '2023-12-12', 4050000, 4050000, 0, 'Bank Statement', 'Posted'
from promissory_notes where name = 'PNWC002';
