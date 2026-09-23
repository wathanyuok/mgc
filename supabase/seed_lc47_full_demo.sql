-- =====================================================================
-- Seed: LC-47 (ฉบับครบสาย) — MA → CA → LC แม่ + 2 ล็อต · ผูก CREDIT AGREEMENT จริง
-- =====================================================================
-- แก้จากเวอร์ชันก่อน: เพิ่ม MA + CA แล้วผูก ca_id ให้ L/C ทุกใบ
-- (CREDIT AGREEMENT เป็น field บังคับ — เดิมปล่อยว่างจึงขึ้นจุดแดง)
--
-- โครงสร้าง:
--   MA-DEMO-LC47 (วงเงินรวม 50M) → จัดสรร MGC 50M
--     → CA-DEMO-LC47 (วงเงินย่อย · facility LC · 20M)
--         → LC-DEMO-TOTAL (แม่ · เหลือ 150,000 USD หลังแบ่ง 2 ล็อต)
--             → LC-DEMO-T-S1 (100,000) · LC-DEMO-T-S2 (50,000)
--   รวมแม่+ลูก = 300,000 USD = ยอดเดิม (นับครั้งเดียว)
--
-- รันซ้ำได้ (ลบลูก → แม่ → CA → MA)
-- =====================================================================

delete from letters_of_credit where lc_no in ('LC-DEMO-T-S1', 'LC-DEMO-T-S2');
delete from letters_of_credit where lc_no = 'LC-DEMO-TOTAL';
delete from credit_agreements where contract_number = 'CA-DEMO-LC47';
delete from ma_subsidiaries   where ma_id = '88888888-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = '88888888-0000-0000-0000-0000000000a0';

-- ① สัญญาหลัก (MA)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('88888888-0000-0000-0000-0000000000a0', 'BBL', 'MA-DEMO-LC47', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

-- ② จัดสรรวงเงินให้ MGC
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('88888888-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ③ วงเงินย่อย (CA) · ประเภท LC · 20M
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('88888888-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน L/C', 'CA-DEMO-LC47',
   '88888888-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'LC' limit 1),
   20000000, 0, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ④ สัญญาแม่ (Active · เหลือ 150,000 หลังแบ่ง 2 ล็อต) · ผูก CA
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
  ('88888888-0000-0000-0000-0000000000c0',
   'LC-DEMO-TOTAL', 'LC เดโม — แบ่ง 2 ล็อต (นับครั้งเดียว)', null,
   '88888888-0000-0000-0000-0000000000ca', 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   150000, 35.20, current_date - 20, 5280000,
   current_date - 20, current_date - 20, current_date + 70, 90,
   current_date + 5, null, 60,
   'full_term', 1.50, 0, 79200,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-2","type":"PREPAID ACCOUNT","gl":"1191405 ค่าใช้จ่ายจ่ายล่วงหน้า-ค่าธรรมเนียม"},
     {"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-4","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้การค้าต่างประเทศ-Non RPT"},
     {"id":"ac-5","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-6","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'เดโมทดสอบ LC-47 · แม่หลังแบ่ง 2 ล็อต', 'Seed', 'Seed');

-- ⑤ ล็อต 1 · 100,000 · ผูก CA เดียวกับแม่
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
  ('88888888-0000-0000-0000-0000000000c1',
   'LC-DEMO-T-S1', 'LC-DEMO-T-S1', '88888888-0000-0000-0000-0000000000c0',
   '88888888-0000-0000-0000-0000000000ca', 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   100000, 35.20, current_date - 12, 3520000,
   current_date - 20, current_date - 12, current_date + 48, 60,
   null, current_date - 12, 60,
   'full_term', 1.50, 0, 52800,
   false, null,
   'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'รับมอบ lot ที่ 1 ของ LC-DEMO-TOTAL', 'Seed', 'Seed');

-- ⑥ ล็อต 2 · 50,000 · ผูก CA เดียวกับแม่
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
  ('88888888-0000-0000-0000-0000000000c2',
   'LC-DEMO-T-S2', 'LC-DEMO-T-S2', '88888888-0000-0000-0000-0000000000c0',
   '88888888-0000-0000-0000-0000000000ca', 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   50000, 35.20, current_date - 6, 1760000,
   current_date - 20, current_date - 6, current_date + 54, 60,
   null, current_date - 6, 60,
   'full_term', 1.50, 0, 26400,
   false, null,
   'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'รับมอบ lot ที่ 2 ของ LC-DEMO-TOTAL', 'Seed', 'Seed');
