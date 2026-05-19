-- =====================================================================
--  Master Data — Interest Rate + Curtailment
-- =====================================================================

drop table if exists interest_rates cascade;
drop table if exists curtailments   cascade;
drop type  if exists interest_type  cascade;

create type interest_type as enum ('MLR', 'MOR', 'MRR', 'MMR', 'Fixed');

-- ---------------------------------------------------------------------
-- Master Interest Rate (MIR)
-- ---------------------------------------------------------------------
create table interest_rates (
  id                  bigserial primary key,
  finance_institution text not null,
  interest_type       interest_type not null,
  base_rate           numeric(7, 4) not null,        -- % (e.g. 7.10)
  margin              numeric(7, 4) not null default 0,
  effective_rate      numeric(7, 4) generated always as (base_rate + margin) stored,
  date_effective      date not null,
  end_effective_date  date,
  status              text not null default 'Active' check (status in ('Active','Inactive')),
  remark              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_mir_fi     on interest_rates(finance_institution);
create index idx_mir_type   on interest_rates(interest_type);
create index idx_mir_status on interest_rates(status);

-- ---------------------------------------------------------------------
-- Curtailment (Vendor + Type, 3 tiers each)
-- ---------------------------------------------------------------------
create table curtailments (
  id                   uuid primary key default uuid_generate_v4(),
  vendor               text not null,
  vehicle_type         text not null,                -- New2024 / Used2024 / ...
  effective_start_date date not null,
  effective_end_date   date,
  -- 3 tiers: days + %
  tier1_days           int,
  tier1_pct            numeric(6, 2),
  tier2_days           int,
  tier2_pct            numeric(6, 2),
  tier3_days           int,
  tier3_pct            numeric(6, 2),
  status               text not null default 'Active' check (status in ('Active','Inactive')),
  remark               text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_curt_vendor on curtailments(vendor);
create index idx_curt_type   on curtailments(vehicle_type);
create index idx_curt_status on curtailments(status);

create trigger trg_mir_updated  before update on interest_rates
  for each row execute function set_updated_at();
create trigger trg_curt_updated before update on curtailments
  for each row execute function set_updated_at();

alter table interest_rates enable row level security;
alter table curtailments   enable row level security;
drop policy if exists "anon_all_ir"   on interest_rates;
drop policy if exists "anon_all_curt" on curtailments;
create policy "anon_all_ir"   on interest_rates for all using (true) with check (true);
create policy "anon_all_curt" on curtailments   for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- Seed (matches HTML demo)
-- ---------------------------------------------------------------------
insert into interest_rates (finance_institution, interest_type, base_rate, margin, date_effective, end_effective_date, status) values
  ('BBL',   'MLR', 7.10, -1.50, '2023-09-29', '2023-12-31', 'Inactive'),
  ('BBL',   'MOR', 7.55, -1.00, '2023-09-29', '2024-09-30', 'Inactive'),
  ('BBL',   'MRR', 7.30,  0.00, '2023-09-29',  null,        'Active'),
  ('BBL',   'MLR', 8.00, -2.50, '2024-01-01',  null,        'Active'),
  ('BBL',   'MOR', 7.60, -1.00, '2024-10-01',  null,        'Active'),
  ('SCB',   'MOR', 7.55, -1.20, '2024-10-01',  null,        'Active'),
  ('SCB',   'MRR', 7.55,  0.50, '2024-10-01',  null,        'Active'),
  ('KBANK', 'MLR', 5.50,  0.00, '2024-01-01', '2024-09-30', 'Inactive'),
  ('KBANK', 'MLR', 5.60, -0.10, '2024-10-01',  null,        'Active'),
  ('KBANK', 'MOR', 7.60, -1.00, '2024-10-01',  null,        'Active');

insert into curtailments
  (vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct, status)
values
  ('BMW (Thailand) Co., Ltd.',       'Used2024', '2024-01-01', '2024-12-31', 200, 10, 270, 10, 360, 80, 'Active'),
  ('BMW (Thailand) Co., Ltd.',       'New2024',  '2024-01-01', '2024-12-31', 180, 15, 270, 15, 360, 70, 'Active'),
  ('Honda Automobile Co., Ltd.',     'New2024',  '2024-01-01', '2024-12-31', 120, 20, 240, 20, 360, 60, 'Active'),
  ('Toyota Motor Thailand',          'New2024',  '2024-01-01', '2024-12-31', 150, 15, 240, 25, 360, 60, 'Active'),
  ('BMW (Thailand) Co., Ltd.',       'Used2023', '2023-01-01', '2023-12-31', 200, 10, 270, 10, 360, 80, 'Inactive');
