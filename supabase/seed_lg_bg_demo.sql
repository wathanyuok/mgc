-- ============================================================
-- Seed: LG / B/G เดโม (letter_guarantees) — FIELD ครบทุกคอลัมน์
--   1) CA-LGBG-DEMO — วงเงิน LG/BG 5,000,000 (facility LG)
--   2) LG-DEMO-001  — หนังสือค้ำประกัน (LG)  · prepaid=true  (จ่ายค่าธรรมเนียมล่วงหน้า · มี refund ตอนยกเลิกก่อนกำหนด) · 2,000,000 · fee 30,000
--   3) BG-DEMO-001  — Bank Guarantee (B/G)   · prepaid=false (Expense Mode · รับรู้เต็ม ไม่มี refund)          · 1,000,000 · fee 15,000
--   => ใช้วงเงินรวม 3,000,000 · คงเหลือ 2,000,000
-- คอลัมน์ letter_guarantees (ปัจจุบัน · ตัด value_date ที่ migration 0079 drop แล้ว):
--   id, lg_no, name, lg_type, ca_id, finance_institution, beneficiary, subject,
--   amount, currency, amount_foreign, conversion_date, conversion_rate,
--   issue_date, expiry_date, prepaid, payment_cycle, payment_date, fee_amount,
--   reference_contract, rate_cards, acct_cards, rollover_parent_id,
--   termination_* (5 ช่อง · null = ไม่มีคำขอยกเลิก), status, remark, created_by, updated_by
-- lg_type ที่ระบบใช้: 'LG' · 'B/G' · 'SBLC'  (ไม่ใช่ 'BG')
-- FIELD ครบ · รันซ้ำได้ (ลบของเดิมก่อน)
-- ============================================================

-- ── ลบของเดิม (รันซ้ำได้) ──
delete from letter_guarantees where lg_no in ('LG-DEMO-001','BG-DEMO-001')
   or id in ('d9d9e000-0000-0000-0000-0000000000a1','d9d9e000-0000-0000-0000-0000000000a2');
delete from credit_agreements where contract_number = 'CA-LGBG-DEMO'
   or id = 'd9d9e000-0000-0000-0000-0000000000c1';

-- ① CA (วงเงิน LG/BG 5 ล้าน)
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9e000-0000-0000-0000-0000000000c1',
   'CA-LGBG-DEMO (วงเงินค้ำประกัน 5 ล้าน)', 'CA-LGBG-DEMO', 'MGC',
   (select id from facility_types where code = 'LG' limit 1),
   5000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ② LG-DEMO-001 · LG · prepaid=true (มี refund) · field ครบ
insert into letter_guarantees
  (id, lg_no, name, lg_type, ca_id, finance_institution, beneficiary, subject,
   amount, currency, amount_foreign, conversion_date, conversion_rate,
   issue_date, expiry_date, prepaid, payment_cycle, payment_date, fee_amount,
   reference_contract, rate_cards, acct_cards, rollover_parent_id,
   termination_requested_by, termination_requested_at, termination_notification_date,
   termination_lead_time_days, termination_refund_schedule,
   status, remark, created_by, updated_by, created_at, updated_at)
values
  ('d9d9e000-0000-0000-0000-0000000000a1','LG-DEMO-001','LGBBL001','LG',
   'd9d9e000-0000-0000-0000-0000000000c1','BBL',
   'บริษัท ผู้รับประโยชน์ ก จำกัด','ค้ำประกันสัญญาก่อสร้าง (Performance Guarantee)',
   2000000,'THB', null, null, null,                                   -- THB ในประเทศ → ไม่มีสกุลต่างประเทศ
   date '2026-09-01', date '2027-08-31', true, 'Annually', date '2026-09-01', 30000,
   'REF-LG-CONTRACT-001','[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"PREPAID FEE ACCOUNT","gl":"1191405 Prepaid Expenses - L/G, B/G"},{"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"}]'::jsonb,
   null,
   null, null, null, null, null,                                     -- ไม่มีคำขอยกเลิก
   'Active','seed LG · prepaid=true · ค่าธรรมเนียม 30,000 จ่ายล่วงหน้า · ตัดบัญชีตามวัน · ยกเลิกก่อนกำหนดมี refund ตามสัดส่วน',
   (select id::text from app_users order by created_at limit 1),
   (select id::text from app_users order by created_at limit 1), now(), now());

-- ③ BG-DEMO-001 · B/G · prepaid=false (Expense Mode · ไม่มี refund) · field ครบ
insert into letter_guarantees
  (id, lg_no, name, lg_type, ca_id, finance_institution, beneficiary, subject,
   amount, currency, amount_foreign, conversion_date, conversion_rate,
   issue_date, expiry_date, prepaid, payment_cycle, payment_date, fee_amount,
   reference_contract, rate_cards, acct_cards, rollover_parent_id,
   termination_requested_by, termination_requested_at, termination_notification_date,
   termination_lead_time_days, termination_refund_schedule,
   status, remark, created_by, updated_by, created_at, updated_at)
values
  ('d9d9e000-0000-0000-0000-0000000000a2','BG-DEMO-001','BGBBL001','B/G',
   'd9d9e000-0000-0000-0000-0000000000c1','BBL',
   'บริษัท ผู้รับประโยชน์ ข จำกัด','ค้ำประกันการยื่นซองประมูล (Bid Bond)',
   1000000,'THB', null, null, null,
   date '2026-09-01', date '2027-08-31', false, 'Quarterly', date '2026-09-01', 15000,  -- payment_date ต้องมี ไม่งั้นปุ่ม "ลงบัญชีค่าธรรมเนียมแรกเข้า" ล็อก
   'REF-BG-CONTRACT-001','[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"}]'::jsonb,
   null,
   null, null, null, null, null,
   'Active','seed B/G · prepaid=false (Expense Mode) · ค่าธรรมเนียม 15,000 รับรู้เป็นค่าใช้จ่ายเต็มจำนวน · ยกเลิกก่อนกำหนดไม่มี refund',
   (select id::text from app_users order by created_at limit 1),
   (select id::text from app_users order by created_at limit 1), now(), now());

-- ④ ตรวจผล
select lg_no, name, lg_type, prepaid, payment_cycle, amount, fee_amount, status,
       (select contract_number from credit_agreements c where c.id = g.ca_id) as ca
  from letter_guarantees g
 where lg_no in ('LG-DEMO-001','BG-DEMO-001')
 order by lg_no;
-- คาดหวัง: LG 2,000,000 + BG 1,000,000 = ใช้วงเงิน 3,000,000 จาก CA-LGBG-DEMO (5,000,000) → เหลือ 2,000,000
