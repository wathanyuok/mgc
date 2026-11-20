-- 0149: Chassis ให้ครบทุกโมดูล (Multi-PO · ChassisSubTab)
--   main ยังไม่มีตาราง chassis ของ TR/LC · และ fp/loan_chassis ยังขาด price_ex_vat/vat_amount
--   PN เก็บ chassis เป็น JSONB column (chassis_list) ไม่ใช่ตารางแยก
--   รวม port จาก cr (0116/0117/0124) มาเป็นไฟล์เดียว · Idempotent รันซ้ำได้
-- =====================================================================

-- ── ตาราง chassis ของ L/C + T/R (โครงเดียวกับ fp/loan_chassis · ChassisRow) ──
create table if not exists lc_chassis (
  id                   uuid primary key default gen_random_uuid(),
  lc_id                uuid not null references letters_of_credit(id) on delete cascade,
  chassis_no           text not null,
  po_ref               text,
  engine_no            text,
  model                text,
  receive_date         date,
  amount               numeric(18,2) not null default 0,
  chassis_price        numeric(18,2),
  price_ex_vat         numeric(18,2),
  vat_amount           numeric(18,2),
  curtail_id           uuid,
  status               text default 'In Stock',
  sort_order           int not null default 0,
  original_location    text,
  current_location     text,
  location_modified_at timestamptz,
  sold_date            date,
  sold_source          text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_lc_chassis_lc on lc_chassis(lc_id);

create table if not exists tr_chassis (
  id                   uuid primary key default gen_random_uuid(),
  tr_id                uuid not null references trust_receipts(id) on delete cascade,
  chassis_no           text not null,
  po_ref               text,
  engine_no            text,
  model                text,
  receive_date         date,
  amount               numeric(18,2) not null default 0,
  chassis_price        numeric(18,2),
  price_ex_vat         numeric(18,2),
  vat_amount           numeric(18,2),
  curtail_id           uuid,
  status               text default 'In Stock',
  sort_order           int not null default 0,
  original_location    text,
  current_location     text,
  location_modified_at timestamptz,
  sold_date            date,
  sold_source          text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_tr_chassis_tr on tr_chassis(tr_id);

alter table lc_chassis enable row level security;
alter table tr_chassis enable row level security;
do $$ begin create policy anon_all_lc_chassis on lc_chassis for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy anon_all_tr_chassis on tr_chassis for all using (true) with check (true); exception when duplicate_object then null; end $$;

-- ── MoM ข้อ 4: ราคาแยก ไม่รวม VAT / VAT ให้ครบทุกตาราง chassis + po_ref ──
alter table fp_chassis   add column if not exists po_ref text;
alter table fp_chassis   add column if not exists price_ex_vat numeric(18,2);
alter table fp_chassis   add column if not exists vat_amount   numeric(18,2);
alter table loan_chassis add column if not exists po_ref text;
alter table loan_chassis add column if not exists price_ex_vat numeric(18,2);
alter table loan_chassis add column if not exists vat_amount   numeric(18,2);
-- tr/lc_chassis อาจมีอยู่แล้วจาก migration เก่า (create if not exists จะข้าม) → เพิ่ม column ตรงนี้ด้วย
alter table lc_chassis   add column if not exists po_ref text;
alter table lc_chassis   add column if not exists price_ex_vat numeric(18,2);
alter table lc_chassis   add column if not exists vat_amount   numeric(18,2);
alter table tr_chassis   add column if not exists po_ref text;
alter table tr_chassis   add column if not exists price_ex_vat numeric(18,2);
alter table tr_chassis   add column if not exists vat_amount   numeric(18,2);

-- ── PN เก็บ chassis เป็น JSONB (ไม่มีตารางแยก) ──
alter table promissory_notes add column if not exists chassis_list jsonb not null default '[]'::jsonb;

comment on table lc_chassis is 'หลักประกัน Chassis ของ L/C (ChassisSubTab · Multi-PO)';
comment on table tr_chassis is 'หลักประกัน Chassis ของ T/R (ChassisSubTab · Multi-PO)';
comment on column promissory_notes.chassis_list is 'รายการ chassis ของ PN (JSONB array · ChassisRow)';
