-- =====================================================================
-- 0130: PN — แก้ตารางคำนวณรายงวดเอง (แบบ Loan)
--   schedule_manual   = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ period, interest?, principalBalance? }] งวดที่พิมพ์ทับ
--   ใช้ให้ยอดดอก/ยอดคงเหลือตรงกับใบธนาคาร (day-count/rounding ต่าง)
-- =====================================================================
alter table promissory_notes add column if not exists schedule_manual boolean not null default false;
alter table promissory_notes add column if not exists schedule_overrides jsonb not null default '[]'::jsonb;
