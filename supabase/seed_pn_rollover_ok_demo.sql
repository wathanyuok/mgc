-- Seed: PN demo สำหรับทดสอบ PN-53 (ต่อสัญญาสำเร็จ) + PN-54 (ใบสำคัญ/JE ตอนต่อสัญญา)
--
-- สร้าง:
--   1) วงเงิน (CA) Revolving · ไม่ตั้งเพดานต่อสัญญา (times/days = null) → ต่อสัญญาสำเร็จเสมอ
--   2) ตั๋ว PN-RO-OK-001 (Active, ยังไม่เคยต่อสัญญา) เงินต้น 1,000,000 · 5%
--
-- ทดสอบ PN-53: เปิด PN-RO-OK-001 → กดปุ่ม "Roll Over" (มุมขวาบน)
--   → ใส่ "Maturity Date ใหม่" เช่น 01/11/2026 → กด "Confirm Roll Over"
--   ผล: ตั๋วเดิม → Roll Over · เกิดตั๋วใหม่ (Draft) · AMOUNT = เงินต้นเดิม + ดอกเบี้ยทบ
--       · Transaction Date ใหม่ = วันครบกำหนดเดิม · REFERENCE CONTRACT = ชื่อตั๋วเดิม
--       · ระบบเปิดตั๋วใหม่ให้อัตโนมัติ
--
-- ทดสอบ PN-54: หลังต่อสัญญา ดูช่อง JE ที่ตั๋วใหม่ (แท็บ Schedule Calculate)
--   ผล: ยังไม่มี JE (ตั๋วใหม่เป็น Draft) → อนุมัติตั๋วใหม่ให้ Active → กด "ลงบัญชีวันเบิกเงิน"
--       → จึงเกิด JE (Dr เงินฝากธนาคาร / Cr ตั๋วเงินจ่าย-P/N) · ไม่มี JE โอนยอดอัตโนมัติตอนต่อสัญญา
--
-- หมายเหตุ: ปุ่ม Roll Over ต้อง login เป็นผู้มีสิทธิ์ approve P/N (สิทธิ์ผู้ใช้ seed ไม่ได้)
-- รันซ้ำได้ (ลบของเดิมก่อน) — รวมถึงลบตั๋วใหม่ที่ต่อสัญญาออกมาด้วย

delete from promissory_notes where rollover_parent_id in (
  select id from promissory_notes where pn_number = 'PN-RO-OK-001'
);
delete from promissory_notes where pn_number = 'PN-RO-OK-001';
delete from credit_agreements where contract_number = 'CA-RO-OK-053';

-- 1) วงเงิน Revolving · ไม่จำกัดการต่อสัญญา
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, rollover_max_times, rollover_max_days, finance_institution,
   start_date, end_date, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000053',
   'CA-RO-OK-DEMO (no rollover cap)', 'CA-RO-OK-053', 'MCR',
   (select id from facility_types where code = 'PN' limit 1),
   50000000, 'THB', 'Revolving', null, null, 'BBL',
   '2026-01-01', '2026-12-31', 'Approved');

-- 2) ตั๋ว Active ยังไม่เคยต่อสัญญา (ใช้ทดสอบ)
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('dddddddd-0000-0000-0000-000000000001',
   'PN-RO-OK-001', 'PN-RO-OK-001', 'aaaaaaaa-0000-0000-0000-000000000053',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-07-01', '2026-09-01', 62, 1000000, 'THB', 'Active', null,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-07-01"}]'::jsonb);
