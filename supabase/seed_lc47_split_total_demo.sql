-- =====================================================================
-- Seed: LC-47 — ยอดรวมหลังแบ่ง 2 ล็อต นับครั้งเดียว (ไม่นับซ้ำแม่+ลูก)
-- =====================================================================
-- จำลองผลของการ "แบ่งรับมอบ 2 ล็อต" ไว้ให้แล้ว (ครบทุก field · ทุกใบ Active):
--   ยอด L/C เดิม = 300,000 USD
--     • แบ่งล็อต 1 = 100,000 → LC-DEMO-T-S1
--     • แบ่งล็อต 2 =  50,000 → LC-DEMO-T-S2
--     • สัญญาแม่ (หักออกแล้ว) = 150,000 → LC-DEMO-TOTAL
--   → รวม แม่ + ลูก = 150,000 + 100,000 + 50,000 = 300,000 (= ยอดเดิม · นับครั้งเดียว)
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด LC-DEMO-TOTAL → การ์ด 3 ใบ: ยอดตาม LC 300,000 · รับมอบแล้ว 150,000 (2 lot)
--        · คงเหลือ 150,000 (เหลือง) · ตาราง sub-LC มี S1, S2
--   2) เปิดรายงานการใช้วงเงิน (Credit Transaction / Credit Utilization Report)
--        → ยอดใช้วงเงินรวมของ L/C ชุดนี้ = 300,000 (ไม่ใช่ 450,000)
--
-- รันซ้ำได้ (ลบลูกก่อนแม่)
-- =====================================================================

delete from letters_of_credit where lc_no in ('LC-DEMO-T-S1', 'LC-DEMO-T-S2');   -- ลูกก่อน
delete from letters_of_credit where lc_no = 'LC-DEMO-TOTAL';

-- ── สัญญาแม่ (หักยอดที่แบ่งออกแล้ว เหลือ 150,000) ────────────────────
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
  ('77777777-0000-0000-0000-0000000000c0',
   'LC-DEMO-TOTAL', 'LC เดโม — แบ่ง 2 ล็อต (นับครั้งเดียว)', null,
   null, 'BBL', 'Sight',
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

-- ── ล็อต 1 (Sub-LC) 100,000 ─────────────────────────────────────────
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
  ('77777777-0000-0000-0000-0000000000c1',
   'LC-DEMO-T-S1', 'LC-DEMO-T-S1', '77777777-0000-0000-0000-0000000000c0',
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   100000, 35.20, current_date - 12, 3520000,
   current_date - 20, current_date - 12, current_date + 48, 60,
   null, current_date - 12, 60,
   'full_term', 1.50, 0, 52800,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'รับมอบ lot ที่ 1 ของ LC-DEMO-TOTAL', 'Seed', 'Seed');

-- ── ล็อต 2 (Sub-LC) 50,000 ──────────────────────────────────────────
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
  ('77777777-0000-0000-0000-0000000000c2',
   'LC-DEMO-T-S2', 'LC-DEMO-T-S2', '77777777-0000-0000-0000-0000000000c0',
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   50000, 35.20, current_date - 6, 1760000,
   current_date - 20, current_date - 6, current_date + 54, 60,
   null, current_date - 6, 60,
   'full_term', 1.50, 0, 26400,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'รับมอบ lot ที่ 2 ของ LC-DEMO-TOTAL', 'Seed', 'Seed');
