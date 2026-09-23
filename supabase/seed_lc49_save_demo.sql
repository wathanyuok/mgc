-- =====================================================================
-- Seed: LC-49 — เปิดแผงรับมอบค้างไว้แล้วกด Save (ต้องบันทึกได้ปกติ)
-- =====================================================================
-- สาย MA → CA → LC แม่ (Active · ผูก CREDIT AGREEMENT จริง · ครบทุก field)
-- ยังไม่แบ่งล็อต → ปุ่ม + รับมอบ Lot กดได้ · คงเหลือรอรับ = เต็มจำนวน
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด LC-DEMO-SAVE → กด + รับมอบ Lot (แผงกรอกโผล่)
--   2) ไม่กรอกอะไรในแผง (ยอด/วันรับของ ปล่อยว่าง)
--   3) กด Save (แถวปุ่มบนสุด) → บันทึกสำเร็จ ไม่ขึ้น error
--
-- รันซ้ำได้ (ลบ LC → CA → MA)
-- =====================================================================

delete from letters_of_credit where lc_no = 'LC-DEMO-SAVE';
delete from credit_agreements where contract_number = 'CA-DEMO-LC49';
delete from ma_subsidiaries   where ma_id = '99999999-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = '99999999-0000-0000-0000-0000000000a0';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('99999999-0000-0000-0000-0000000000a0', 'BBL', 'MA-DEMO-LC49', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

-- ② จัดสรร MGC
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('99999999-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ③ CA · ประเภท LC
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('99999999-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน L/C (LC49)', 'CA-DEMO-LC49',
   '99999999-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'LC' limit 1),
   20000000, 0, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ④ L/C แม่ Active · ยังไม่แบ่งล็อต (คงเหลือรอรับ = 200,000 เต็ม)
insert into letters_of_credit
  (id, lc_no, name, parent_lc_id, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency,
   amount_foreign, conversion_rate, conversion_date, amount,
   issue_date, transaction_date, expiry_date, term_days,
   estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   shared_limit_with_tr, reference_contract,
   status, rate_cards, acct_cards, remark, created_by, updated_by)
values
  ('99999999-0000-0000-0000-0000000000c0',
   'LC-DEMO-SAVE', 'LC เดโม — ทดสอบ Save ตอนเปิดแผงรับมอบ', null,
   '99999999-0000-0000-0000-0000000000ca', 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   200000, 35.20, current_date - 10, 7040000,
   current_date - 10, current_date - 10, current_date + 80, 90,
   current_date + 8, null, 60,
   'full_term', 1.50, 0, 105600,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-2","type":"PREPAID ACCOUNT","gl":"1191405 ค่าใช้จ่ายจ่ายล่วงหน้า-ค่าธรรมเนียม"},
     {"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-4","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้การค้าต่างประเทศ-Non RPT"},
     {"id":"ac-5","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-6","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'เดโมทดสอบ LC-49 (เปิดแผงรับมอบค้างแล้วกด Save)', 'Seed', 'Seed');
