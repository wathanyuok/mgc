-- Seed: demo สำหรับทดสอบ LG-13 (จำนวนเงินเกินวงเงินคงเหลือ)
--
-- สร้าง:
--   1) วงเงิน CA-LG-DEMO-013 (LG) · credit_line 1,000,000
--   2) LG ที่ใช้วงเงินไปแล้ว 800,000 (Active) → เหลือ 200,000
--
-- ทดสอบ: สร้าง LG/BG ใหม่ → เลือก CREDIT AGREEMENT = "CA-LG-DEMO-013 ..."
--   → กรอก AMOUNT มากกว่า 200,000 (เช่น 500,000) → กด Save
--   ผล: บันทึกไม่ได้ · toast แดง
--   "วงเงินเต็มแล้ว — วงเงิน 1,000,000.00 · ใช้ไป 800,000.00 · คงเหลือ 200,000.00
--    · รายการนี้ 500,000.00 เกินวงเงิน ขอเพิ่มไม่ได้ (ต้องเพิ่มวงเงินที่ MA/CA ก่อน)"
--
-- รันซ้ำได้ (ลบ LG + CA เดิมก่อน)

delete from letter_guarantees where lg_no = 'LG-DEMO-USED-013A';
delete from credit_agreements where contract_number = 'CA-LG-DEMO-013';

-- 1) วงเงิน LG credit_line 1,000,000
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('33333333-0000-0000-0000-000000000013',
   'CA-LG-DEMO (วงเงิน LG 1 ล้าน)', 'CA-LG-DEMO-013', 'MCR',
   (select id from facility_types where code = 'LG' limit 1),
   1000000, 'THB', 'Revolving', 'BBL',
   current_date - 30, current_date + 335, 'Approved');

-- 2) LG ที่ใช้วงเงินไปแล้ว 800,000 (Active) → เหลือ 200,000
insert into letter_guarantees
  (id, lg_no, lg_type, ca_id, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status)
values
  ('33333333-0000-0000-0000-00000000013a',
   'LG-DEMO-USED-013A', 'LG', '33333333-0000-0000-0000-000000000013', 'BBL',
   'บริษัท ผู้รับประโยชน์ ก จำกัด', 'ค้ำประกันสัญญา (ใช้วงเงินไปแล้ว)',
   800000, 'THB', current_date - 10, current_date + 200, 'Active');
