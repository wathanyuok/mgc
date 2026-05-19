-- =====================================================================
--  MGC-Asia ERP — Lease Module · Initial Schema (v2 - matches HTML proto)
--  Author: YIP × MGC · Phase 1
--  Faithful port of master_agreement_v30.html field layout.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- Drop existing tables (re-run safe; comment out if data already in use)
drop table if exists lease_schedules     cascade;
drop table if exists leases              cascade;
drop table if exists credit_agreements   cascade;
drop table if exists ma_subsidiaries     cascade;
drop table if exists ma_collaterals      cascade;
drop table if exists ma_guarantors       cascade;
drop table if exists ma_conditions       cascade;
drop table if exists ma_documents        cascade;
drop table if exists master_agreements   cascade;
drop type  if exists ma_status     cascade;
drop type  if exists ca_status     cascade;
drop type  if exists lease_mode    cascade;
drop type  if exists lease_status  cascade;

-- ---------------------------------------------------------------------
-- Enums (status badges in HTML)
-- ---------------------------------------------------------------------
create type ma_status    as enum ('Draft', 'Approved', 'Rejected', 'Expired', 'Terminated');
create type ca_status    as enum ('Draft', 'Approved', 'Expired', 'Closed');
create type lease_mode   as enum ('hp', 'other');
create type lease_status as enum ('Draft', 'Active', 'Closed', 'Modified');

-- ---------------------------------------------------------------------
-- Master Agreement (MA) — matches Primary + Credit Line Information sections
-- ---------------------------------------------------------------------
create table master_agreements (
  id                  uuid primary key default uuid_generate_v4(),
  -- Primary Information
  inactive            boolean not null default false,
  finance_institution text not null,           -- KBANK / SCB / BBL / KTB / BAY / TTB / UOB / BMW FS
  ma_name             text not null unique,    -- e.g. MGC-HP-2024-001
  subsidiary          text not null,           -- primary subsidiary (Millennium ... )
  status              ma_status not null default 'Draft',
  start_date          date not null,
  end_date            date not null,
  -- Credit Line Information
  credit_line         numeric(18, 2) not null default 0,
  utilization         numeric(18, 2) not null default 0,
  remaining_credit    numeric(18, 2) generated always as (credit_line - utilization) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_ma_status        on master_agreements(status);
create index idx_ma_subsidiary    on master_agreements(subsidiary);
create index idx_ma_fi            on master_agreements(finance_institution);

-- Parent-Child subsidiary allocation table
create table ma_subsidiaries (
  id          uuid primary key default uuid_generate_v4(),
  ma_id       uuid not null references master_agreements(id) on delete cascade,
  subsidiary  text not null,                   -- MCR / MAG / MIE / MAS / ...
  credit_line numeric(18, 2) not null default 0,
  utilization numeric(18, 2) not null default 0,
  remaining   numeric(18, 2) generated always as (credit_line - utilization) stored,
  sort_order  int not null default 0
);
create index idx_ma_subs_ma on ma_subsidiaries(ma_id);

-- Condition tab — D/E, DSCR, other-req, consent (one row per MA)
create table ma_conditions (
  ma_id            uuid primary key references master_agreements(id) on delete cascade,
  de_op            text default '<=',          -- ≤ < = ≥ >
  de_value         numeric(8, 2),
  dscr_op          text default '>=',
  dscr_value       numeric(8, 2),
  other_requirement text,
  consent_waiver   text
);

-- Collateral tab — flexible JSON for different collateral types
create table ma_collaterals (
  id          uuid primary key default uuid_generate_v4(),
  ma_id       uuid not null references master_agreements(id) on delete cascade,
  type        text not null,                   -- realestate / vehicle / cash / ...
  fields      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_ma_col_ma on ma_collaterals(ma_id);

-- Guarantor tab
create table ma_guarantors (
  id          uuid primary key default uuid_generate_v4(),
  ma_id       uuid not null references master_agreements(id) on delete cascade,
  type        text not null,                   -- บุคคลค้ำประกัน / นิติบุคคลค้ำประกัน
  fields      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_ma_guar_ma on ma_guarantors(ma_id);

-- Document tab
create table ma_documents (
  id          uuid primary key default uuid_generate_v4(),
  ma_id       uuid not null references master_agreements(id) on delete cascade,
  file_name   text not null,
  file_type   text,
  size_bytes  bigint,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);
create index idx_ma_doc_ma on ma_documents(ma_id);

-- ---------------------------------------------------------------------
-- Credit Agreement (CA) — sub-facility under an MA
-- ---------------------------------------------------------------------
create table credit_agreements (
  id              uuid primary key default uuid_generate_v4(),
  ma_id           uuid references master_agreements(id) on delete set null,
  ca_name         text not null,               -- e.g. CA-HP001
  contract_number text not null unique,        -- e.g. HP2024-001
  subsidiary      text not null,               -- MCR / MAG / ...
  facility_type   text not null default 'HP',  -- HP / Lease / Loan / LG / PN / FP / OD / FXF
  credit_line     numeric(18, 2) not null default 0,
  utilization     numeric(18, 2) not null default 0,
  remaining       numeric(18, 2) generated always as (credit_line - utilization) stored,
  start_date      date not null,
  end_date        date not null,
  status          ca_status not null default 'Draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_ca_ma     on credit_agreements(ma_id);
create index idx_ca_status on credit_agreements(status);

-- ---------------------------------------------------------------------
-- Lease (HP Motor + Lease IFRS 16)
-- ---------------------------------------------------------------------
create table leases (
  id                uuid primary key default uuid_generate_v4(),
  lease_no          text not null unique,
  ca_id             uuid references credit_agreements(id) on delete set null,
  mode              lease_mode not null default 'hp',
  use_bank_loan     boolean not null default true,
  asset_type        text not null,
  asset_name        text not null,
  vendor            text,
  vehicle_price     numeric(18, 2),
  down_payment      numeric(18, 2),
  net_vehicle_cost  numeric(18, 2),
  principal         numeric(18, 2) not null,
  annual_rate       numeric(7, 4) not null,
  term_months       int not null,
  start_date        date not null,
  balloon_amount    numeric(18, 2),
  balloon_pattern   text,
  upfront_payment   numeric(18, 2),
  grace_periods     int,
  prepaid_periods   int,
  discount_rate     numeric(7, 4),
  status            lease_status not null default 'Draft',
  remark            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_lease_status on leases(status);
create index idx_lease_ca     on leases(ca_id);

create table lease_schedules (
  id            uuid primary key default uuid_generate_v4(),
  lease_id      uuid not null references leases(id) on delete cascade,
  period        int not null,
  due_date      date not null,
  begin_balance numeric(18, 2) not null,
  payment       numeric(18, 2) not null,
  interest      numeric(18, 2) not null,
  principal     numeric(18, 2) not null,
  end_balance   numeric(18, 2) not null,
  note          text,
  paid          boolean not null default false,
  paid_date     date,
  created_at    timestamptz not null default now(),
  unique (lease_id, period)
);
create index idx_sched_lease on lease_schedules(lease_id);

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_ma_updated    before update on master_agreements
  for each row execute function set_updated_at();
create trigger trg_ca_updated    before update on credit_agreements
  for each row execute function set_updated_at();
create trigger trg_lease_updated before update on leases
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Auto-roll up MA utilization from ma_subsidiaries
-- ---------------------------------------------------------------------
create or replace function recalc_ma_utilization()
returns trigger language plpgsql as $$
declare target uuid;
begin
  target := coalesce(new.ma_id, old.ma_id);
  if target is null then return new; end if;
  update master_agreements
     set utilization = coalesce((select sum(utilization) from ma_subsidiaries where ma_id = target), 0)
   where id = target;
  return new;
end $$;

create trigger trg_subs_recalc
  after insert or update or delete on ma_subsidiaries
  for each row execute function recalc_ma_utilization();

-- ---------------------------------------------------------------------
-- RLS — open for prototype; tighten when auth wired.
-- ---------------------------------------------------------------------
do $$ declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('master_agreements','ma_subsidiaries','ma_collaterals',
                        'ma_guarantors','ma_conditions','ma_documents',
                        'credit_agreements','leases','lease_schedules')
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon_all_%I" on %I', t, t);
    execute format('create policy "anon_all_%I" on %I for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seed data (matches HTML demo)
-- ---------------------------------------------------------------------
insert into master_agreements (finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line)
values
  ('KBANK', 'MGC-HP-2024-001', 'Millennium Cars (MCR)',       'Approved', '2024-01-01', '2026-12-31', 50000000),
  ('KBANK', 'MGC-HP-2024-002', 'Millennium Auto Group (MAG)', 'Approved', '2024-01-01', '2026-12-31', 25000000);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
select id, 'MCR', 30000000, 5850000, 0 from master_agreements where ma_name = 'MGC-HP-2024-001'
union all
select id, 'MAG', 20000000,       0, 1 from master_agreements where ma_name = 'MGC-HP-2024-001'
union all
select id, 'MAG', 25000000, 2300000, 0 from master_agreements where ma_name = 'MGC-HP-2024-002';

insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, credit_line, utilization, start_date, end_date, status)
select id, 'CA-HP001', 'HP2024-001', 'MCR', 'HP', 30000000::numeric, 5850000::numeric, '2024-01-01'::date, '2026-12-31'::date, 'Approved'::ca_status from master_agreements where ma_name = 'MGC-HP-2024-001'
union all
select id, 'CA-HP002', 'HP2024-002', 'MAG', 'HP', 20000000::numeric,       0::numeric, '2024-01-01'::date, '2026-12-31'::date, 'Approved'::ca_status from master_agreements where ma_name = 'MGC-HP-2024-001'
union all
select id, 'CA-HP003', 'HP2024-003', 'MAG', 'HP', 25000000::numeric, 2300000::numeric, '2024-01-01'::date, '2026-12-31'::date, 'Approved'::ca_status from master_agreements where ma_name = 'MGC-HP-2024-002';

insert into ma_conditions (ma_id, de_op, de_value, dscr_op, dscr_value, other_requirement, consent_waiver)
select id, '<=', 4.0, '>=', 1.2,
  'กำหนดให้เงินกู้ยืมกรรมการ หรือ ผู้ถือหุ้น หรือ บุคคลที่เกี่ยวข้องกันเป็น Subordinated Loan ต่อจากเงินกู้ธนาคาร',
  '28/12/23 ได้รับอนุมัติให้ผ่อนผัน D/E จาก 7.5X เป็น 7.7X แล้ว'
from master_agreements;
