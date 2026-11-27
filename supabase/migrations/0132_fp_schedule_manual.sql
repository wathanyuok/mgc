-- =====================================================================
-- 0132: Floor Plan (FP) — แก้ตารางคำนวณรายงวดเอง (แบบ Loan/PN)
--   schedule_manual    = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ period, interest?, curtailAmount?, principalBalance? }] งวดที่พิมพ์ทับ
--   ไว้ปรับดอก/ลดต้น(Curtailment)/เงินต้นคงเหลือ ต่องวดให้ตรงใบธนาคาร
-- =====================================================================
alter table floor_plans add column if not exists schedule_manual boolean not null default false;
alter table floor_plans add column if not exists schedule_overrides jsonb not null default '[]'::jsonb;
