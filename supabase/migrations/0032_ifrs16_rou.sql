-- =====================================================================
--  IFRS 16 — ROU Asset depreciation + Asset Transfer
--  MoM Day4 §4–§8:
--    - ROU Asset Useful Life อาจไม่เท่ากับ Lease Liability Term
--      (Liability = อายุที่มีภาระจ่าย; ROU = อายุการใช้งานจริง มักเท่าสัญญาเต็ม)
--    - ROU ตัดค่าเสื่อมแบบเส้นตรง (straight-line) เริ่มตั้งแต่ Day 1
--    - Asset Transfer 5 scenarios (โอนเปลี่ยนประเภทสินทรัพย์)
-- =====================================================================

-- ROU Asset useful life (months). Null/0 → falls back to term_months.
alter table leases add column if not exists rou_useful_life integer;

-- Asset Transfer log — one row per transfer event (with the posted JE link).
create table if not exists lease_asset_transfers (
  id            uuid primary key default gen_random_uuid(),
  lease_id      uuid not null references leases(id) on delete cascade,
  transfer_date date not null,
  scenario      text not null,           -- 'ROU_PPE' | 'ROU_IP' | 'ROU_HELD_SALE' | 'ROU_OL' | 'PPE_IP'
  from_type     text not null,           -- e.g. 'ROU Asset'
  to_type       text not null,           -- e.g. 'PPE (Owned Asset)'
  amount        numeric not null default 0,  -- NBV transferred (Cr from / Dr to)
  je_id         uuid references journal_entries(id),
  note          text,
  created_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_lease_asset_transfers_lease on lease_asset_transfers(lease_id);

alter table lease_asset_transfers enable row level security;
do $$ begin
  create policy anon_all_lease_asset_transfers on lease_asset_transfers for all using (true) with check (true);
exception when duplicate_object then null; end $$;
