-- Seed: demo สำหรับทดสอบสถานะ "Pending Conversion" ของ L/C
--
-- สร้าง:
--   1) วงเงิน CA-LC-DEMO-CONV (LC) · credit_line 20,000,000 · Approved
--   2) L/C ที่ Maker กด "Convert → T/R" + ส่งคำขอแล้ว → status = Pending Conversion
--      (เก็บ conversion_req_date / conversion_req_term_days · ยังไม่ลง JE · ยังไม่สร้าง T/R)
--
-- ทดสอบ:
--   • เปิดเมนู Letter of Credit → เปิด "LC-DEMO-CONV-001"
--     จะเห็นแผง "รออนุมัติแปลงเป็น T/R" (ขอแปลงโดย ... · วันเปิด T/R ... · Term ...)
--   • login เป็นผู้มีสิทธิ์ approve (คนละคนกับผู้ขอ) → กด "อนุมัติแปลง T/R"
--     ผล: ลง JE + สร้าง T/R (Draft) + สถานะเป็น Converted
--   • ผู้ขอแปลงเอง (Maker ทดสอบ) จะกดอนุมัติไม่ได้ (blockSelfConvert)
--
-- ต้องรัน migration 0109 ก่อน (เพิ่มค่า 'Pending Conversion' + คอลัมน์ conversion_req_*)
-- รันซ้ำได้ (ลบ LC + CA เดิมก่อน)

delete from letters_of_credit  where lc_no = 'LC-DEMO-CONV-001';
delete from credit_agreements  where contract_number = 'CA-LC-DEMO-CONV';

-- 1) วงเงิน LC 20 ล้าน (Approved)
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('44444444-0000-0000-0000-0000000000c1',
   'CA-LC-DEMO (วงเงิน L/C 20 ล้าน)', 'CA-LC-DEMO-CONV', 'MCR',
   (select id from facility_types where code = 'LC' limit 1),
   20000000, 'THB', 'Revolving', 'SCB',
   current_date - 60, current_date + 305, 'Approved');

-- 2) L/C ที่รออนุมัติแปลงเป็น T/R (Pending Conversion)
insert into letters_of_credit
  (id, lc_no, name, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency, amount_foreign, conversion_rate, amount,
   issue_date, expiry_date, transaction_date, term_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   status,
   conversion_requested_by, conversion_requested_at, conversion_req_date, conversion_req_term_days,
   submitted_by, submitted_at)
values
  ('44444444-0000-0000-0000-0000000000c2',
   'LC-DEMO-CONV-001', null,
   '44444444-0000-0000-0000-0000000000c1', 'SCB', 'SBLC',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด',
   'USD', 250000, 35.20, 8800000,
   current_date - 20, current_date + 70, current_date - 20, 90,
   'full_term', 1.48, 0, 130240,
   'Pending Conversion',
   'Maker ทดสอบ', now() - interval '1 hour', current_date, 90,
   'Maker ทดสอบ', now() - interval '1 hour');
