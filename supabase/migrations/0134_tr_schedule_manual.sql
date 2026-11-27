-- =====================================================================
-- 0134: Trust Receipt (TR) — แก้ตารางคำนวณรายงวดเอง (แบบ PN)
--   schedule_manual    = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ period, interest?, principalBalance? }] งวดที่พิมพ์ทับ
--   TR คิดดอกต่องวด + เงินต้นชำระงวดสุดท้าย (เหมือน P/N) จึงเปิดแก้ดอก/เงินต้นคงเหลือ
--     ต่องวดให้ตรงใบธนาคาร · override อ้างอิงด้วย "งวด" (period)
-- =====================================================================
alter table trust_receipts add column if not exists schedule_manual boolean not null default false;
alter table trust_receipts add column if not exists schedule_overrides jsonb not null default '[]'::jsonb;
