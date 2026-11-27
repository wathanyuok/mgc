-- =====================================================================
-- 0131: LG/BG — แก้ตารางค่าธรรมเนียมรายงวดเอง (แบบ Loan/PN)
--   schedule_manual    = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ period, feeAmount?, guaranteeAmount? }] งวดที่พิมพ์ทับ
--   ไว้ปรับค่าธรรมเนียม/วงเงินค้ำคงเหลือต่องวดให้ตรงใบธนาคาร
-- =====================================================================
alter table letter_guarantees add column if not exists schedule_manual boolean not null default false;
alter table letter_guarantees add column if not exists schedule_overrides jsonb not null default '[]'::jsonb;
