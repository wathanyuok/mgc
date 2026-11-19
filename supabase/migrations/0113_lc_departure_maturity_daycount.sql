-- =====================================================================
-- 0113 — L/C: เพิ่มช่องวันที่ตาม MoM 30 Sep 2026 (ทบทวน Logic เรื่องวันที่ / วันที่เริ่มต้น)
--   Requirement #8 (Letter of Credit): แยกวันให้ชัด + เพิ่ม Departure Date
--     departure_date  = วันเรือออกจากต้นทาง (Departure) — ใช้เป็นฐานนับวันได้
--     maturity_date   = วันครบกำหนดจ่ายจริง (แยกจาก expiry_date ที่เป็นวันหมดอายุ L/C ตัวแม่)
--     day_count_base  = ฐานการนับวัน: 'issue' (วันเปิด) | 'departure' (วันเรือออก)
--   *** ฟิลด์ใหม่ — รอ Reconfirm กับลูกค้า (แสดง label สีแดงในหน้าจอ) ***
-- =====================================================================
alter table letters_of_credit add column if not exists departure_date date;
alter table letters_of_credit add column if not exists maturity_date  date;
alter table letters_of_credit add column if not exists day_count_base text not null default 'issue';

comment on column letters_of_credit.departure_date is 'วันเรือออกจากต้นทาง (Departure) — ใช้เป็นฐานนับวันได้ · เพิ่มตาม MoM 30Sep2026';
comment on column letters_of_credit.maturity_date  is 'วันครบกำหนดจ่ายจริง — แยกจาก expiry_date (วันหมดอายุ L/C ตัวแม่) · เพิ่มตาม MoM 30Sep2026';
comment on column letters_of_credit.day_count_base is 'ฐานการนับวัน: issue | departure · เพิ่มตาม MoM 30Sep2026';
