-- 0152: เก็บเลข Invoice รายคันในตารางลูก chassis (FP / TR / LC / Loan)
--   Invoice ติดมากับรถตอนเลือกจาก NetSuite Inventory (Lookup Chassis)
--   เดิมแสดงได้ตอนเลือก แต่ไม่ persist หลัง reload เพราะตารางลูกไม่มีคอลัมน์
--   (PN เก็บใน chassis_list jsonb อยู่แล้ว — ไม่ต้องแก้)
--
-- Idempotent — รันซ้ำได้
alter table fp_chassis   add column if not exists invoice text;
alter table tr_chassis   add column if not exists invoice text;
alter table lc_chassis   add column if not exists invoice text;
alter table loan_chassis add column if not exists invoice text;

comment on column fp_chassis.invoice   is 'เลข Invoice จาก NetSuite (ตอนรับรถ) — ติดมากับรถตอน Lookup Inventory';
comment on column tr_chassis.invoice   is 'เลข Invoice จาก NetSuite (ตอนรับรถ) — ติดมากับรถตอน Lookup Inventory';
comment on column lc_chassis.invoice   is 'เลข Invoice จาก NetSuite (ตอนรับรถ) — ติดมากับรถตอน Lookup Inventory';
comment on column loan_chassis.invoice is 'เลข Invoice จาก NetSuite (ตอนรับรถ) — ติดมากับรถตอน Lookup Inventory';
