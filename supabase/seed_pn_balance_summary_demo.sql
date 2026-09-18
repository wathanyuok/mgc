-- ============================================================
-- Seed: PN-39 — แท็บ Balance Summary (สรุปยอด + เทียบการชำระจริง)
-- P/N (Active) กรอกครบ · เงินต้น 1,200,000 · 6% · 01/06/2026 → 01/12/2026 (183 วัน)
-- + รายการรับชำระจริง (Posted) 1 ใบ → เห็นส่วน "Repayments Received (Actual)"
--
-- ทดสอบ: เปิด PN-DEMO-BAL-001 → แท็บ Balance Summary
--   ซ้าย  : Effective Interest Rate 6.00% · Term (Days) 183 · Total Principal 1,200,000
--           · Total Interest (คำนวณ) · Accumulated Accrued Interest
--   ขวา   : ตาราง Actual (Principal / Interest → Total · Repayment · Remaining)
--   ล่าง  : Repayments Received (Actual) = Principal 200,000 + Interest 36,000
-- ============================================================
begin;

-- ล้างของเดิม (repayment_lines cascade ตาม repayments) — ครอบ id + เลขที่
delete from repayments
 where repayment_no = 'RP-DEMO-BAL-001'
    or facility_id  = 'cccccccc-3939-4000-8000-000000000039';
delete from promissory_notes
 where pn_number = 'PN-DEMO-BAL-001'
    or id = 'cccccccc-3939-4000-8000-000000000039';

-- P/N (Active) — กรอกครบ
insert into promissory_notes
  (id, name, pn_number, finance_institution, facility_type_id,
   transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('cccccccc-3939-4000-8000-000000000039', 'PN-DEMO-BAL', 'PN-DEMO-BAL-001', 'KBANK',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-06-01', '2026-12-01', 183, 1200000, 'THB', 'Active',
   '[
      {"id":"rc-1","type":"Fixed","rate":6,"condition":0,"start_date":"2026-06-01"}
    ]'::jsonb);

-- ใบรับชำระ (Posted) — งวด ก.ย. 2026 · จ่ายดอกเบี้ย 36,000 + ลดต้นบางส่วน 200,000
insert into repayments
  (id, repayment_no, facility_type_id, facility_id, pay_date, amount,
   principal, interest, fee, vat, wht, channel, status)
values
  ('cccccccc-3939-4000-8000-0000000000a1', 'RP-DEMO-BAL-001',
   (select id from facility_types where code = 'PN' limit 1),
   'cccccccc-3939-4000-8000-000000000039', '2026-09-30', 236000,
   200000, 36000, 0, 0, 0, 'Bank Statement', 'Posted');

insert into repayment_lines
  (repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order)
values
  ('cccccccc-3939-4000-8000-0000000000a1', 'PN', 'cccccccc-3939-4000-8000-000000000039',
   'PN-DEMO-BAL-001', 'Principal', 200000, 0),
  ('cccccccc-3939-4000-8000-0000000000a1', 'PN', 'cccccccc-3939-4000-8000-000000000039',
   'PN-DEMO-BAL-001', 'Interest', 36000, 1);

commit;

-- ตรวจ: PN-DEMO-BAL-001 → แท็บ Balance Summary
--   Effective Interest Rate = 6.00% · Term (Days) = 183 · Total Principal = 1,200,000
--   ส่วน Repayments Received (Actual): Principal 200,000 · Interest 36,000 · Total Paid 236,000
