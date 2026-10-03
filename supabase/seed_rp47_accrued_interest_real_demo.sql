-- ============================================================
-- Seed: RP-47 — ตัดดอกเบี้ยของสัญญาที่เคยตั้งค้างจ่ายไว้ → Dr ล้างค้างจ่าย (ไม่ลงค่าใช้จ่ายซ้ำ)
--
--   • CA-RP47-DEMO   วงเงิน PN 10,000,000
--   • PN-RP47        ตั๋ว 5,000,000 (Active) ใต้ CA
--   • JE เบิกเงิน (PN_DRAWDOWN · Posted) : Dr 1001201 / Cr 2142101
--   • JE ตั้งดอกเบี้ยค้างจ่าย (PN_ACCRUED · Posted) 1 เดือน = 5,000,000 × 5% ÷ 12 = 20,833.33
--       Dr 5512109 ดอกเบี้ยจ่าย-PN        19,863.01
--       Cr 2197109 ดอกเบี้ยค้างจ่าย        19,863.01   ← ตั้งสิ้นเดือน
--   • JE กลับรายการอัตโนมัติ (PN_ACCRUED · is_reversal · 01/10) : Dr 2197109 / Cr 5512109 19,863.01
--
-- วิธีทดสอบ RP-47:
--   1. เมนู Payments → Repayment → New → FACILITY TYPE = PN → เลือก PN-RP47
--   2. Payment Category = Interest — ดอกเบี้ย → ใส่ 19,863.01 → ดูตัวอย่างบัญชีด้านล่าง / Create Journal
--   ผล: Dr 2197109 ดอกเบี้ยค้างจ่าย "ล้างดอกเบี้ยค้างจ่าย" (ไม่ใช่ Dr 5512103 ค่าใช้จ่ายซ้ำ)
--       Cr 1001201 เงินฝาก (ช่องทาง Bank Statement)
--
-- เทียบคู่: ถ้าสัญญา "ไม่เคย" ตั้งค้างจ่าย ระบบจะ Dr 5512103 ดอกเบี้ยจ่าย แทน (รับรู้ค่าใช้จ่ายทันที)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from je_lines where je_id in ('d9d9e200-0000-0000-0000-0000000000d1','d9d9e200-0000-0000-0000-0000000000d2','d9d9e200-0000-0000-0000-0000000000d3');
delete from journal_entries where id in ('d9d9e200-0000-0000-0000-0000000000d1','d9d9e200-0000-0000-0000-0000000000d2','d9d9e200-0000-0000-0000-0000000000d3');
delete from promissory_notes where id = 'd9d9e200-0000-0000-0000-0000000000a1' or pn_number = 'PN-RP47';
delete from credit_agreements where id = 'd9d9e200-0000-0000-0000-0000000000c1' or contract_number = 'CA-RP47-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e200-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e200-0000-0000-0000-0000000000c2' or ma_name = 'MA-RP47-DEMO';

-- ①a MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e200-0000-0000-0000-0000000000c2','BBL','MA-RP47-DEMO','MGC','Approved',
   date '2026-09-01', date '2027-08-31', 10000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e200-0000-0000-0000-0000000000c2','MGC',10000000,0,0);

-- ①b CA (วงเงิน PN · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9e200-0000-0000-0000-0000000000c1','d9d9e200-0000-0000-0000-0000000000c2',
   'CA-RP47-DEMO (วงเงิน PN 10 ล้าน)', 'CA-RP47-DEMO', 'MGC',
   (select id from facility_types where code='PN' limit 1),
   10000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ② PN — ตั๋ว 5 ล้าน (Active · เบิกเงินแล้ว · ตั้งดอกเบี้ยค้างจ่ายไว้ 1 เดือน)
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id, transaction_date, maturity_date,
   term_days, amount, currency, effective_rate, reference_contract, status, remark,
   rate_cards, acct_cards, chassis_list, accrued_interest, created_at, updated_at)
values
  ('d9d9e200-0000-0000-0000-0000000000a1','PN-RP47','PN-RP47',
   'd9d9e200-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-09-01', date '2026-12-01', 91, 5000000, 'THB', 5.0,
   'REF-RP47', 'Active', 'seed RP-47 · PN ที่ตั้งดอกเบี้ยค้างจ่ายไว้แล้ว ไว้ทดสอบตัดดอกเบี้ย (ล้าง 2197109)',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, 19863.01, now(), now());

-- ③ JE เบิกเงิน (PN_DRAWDOWN · Posted)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e200-0000-0000-0000-0000000000d1','JE-RP47-DRAW','PN_DRAWDOWN',
   'd9d9e200-0000-0000-0000-0000000000a1', 0, date '2026-09-01','Sep 2026',
   'Drawdown PN-RP47 — เบิกเงิน 5,000,000', 5000000, 5000000, 'Posted',
   'seed', now(), false, 'seed RP-47 · เบิกเงินวันแรก', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e200-0000-0000-0000-0000000000e1','d9d9e200-0000-0000-0000-0000000000d1',1,
   '1001201','C/A - BBL#181-3-11063-0',5000000,0,'เงินฝากจากการเบิก PN-RP47'),
  ('d9d9e200-0000-0000-0000-0000000000e2','d9d9e200-0000-0000-0000-0000000000d1',2,
   '2142101','เงินกู้ยืมระยะสั้น-สถาบันการเงิน',0,5000000,'ตั๋วเงินจ่าย-P/N');

-- ④ JE ตั้งดอกเบี้ยค้างจ่าย (PN_ACCRUED · Posted) — Dr ค่าใช้จ่าย / Cr ค้างจ่าย
--    (source_type ต้องตรงกับ accruedSourceTypeFor('PN')='PN_ACCRUED' ให้ระบบเจอตอนตัดชำระ)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e200-0000-0000-0000-0000000000d2','JE-RP47-ACCR','PN_ACCRUED',
   'd9d9e200-0000-0000-0000-0000000000a1', 1, date '2026-09-30','Sep 2026',
   'ตั้งดอกเบี้ยค้างจ่าย PN-RP47 งวด 1 (5,000,000 × 5% × 29/365)', 19863.01, 19863.01, 'Posted',
   'seed', now(), false, 'seed RP-47 · ดอกเบี้ยค้างจ่าย งวด 1 (29 วัน ×/365)', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e200-0000-0000-0000-0000000000e3','d9d9e200-0000-0000-0000-0000000000d2',1,
   '5512109','ดอกเบี้ยจ่าย-PN',19863.01,0,'รับรู้ดอกเบี้ยเป็นค่าใช้จ่าย (ค้างจ่าย)'),
  ('d9d9e200-0000-0000-0000-0000000000e4','d9d9e200-0000-0000-0000-0000000000d2',2,
   '2197109','ดอกเบี้ยค้างจ่าย-สถาบันการเงิน',0,19863.01,'ตั้งดอกเบี้ยค้างจ่าย (ยอดที่ต้องล้างตอนจ่าย)');


-- ④b JE กลับรายการอัตโนมัติ (PN_ACCRUED · is_reversal=true · วันที่ 1 เดือนถัดไป) — ให้ตรง flow จริงของหน้า PN
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e200-0000-0000-0000-0000000000d3','JE-RP47-ACCR-REV','PN_ACCRUED',
   'd9d9e200-0000-0000-0000-0000000000a1', 1, date '2026-10-01','Oct 2026',
   'Reverse accrued interest PN-RP47 งวด 1 — 1st of next month', 19863.01, 19863.01, 'Posted',
   'seed', now(), true, 'seed RP-47 · กลับรายการดอกเบี้ยค้างจ่ายอัตโนมัติ', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e200-0000-0000-0000-0000000000e5','d9d9e200-0000-0000-0000-0000000000d3',1,
   '2197109','ดอกเบี้ยค้างจ่าย-สถาบันการเงิน',19863.01,0,'กลับรายการดอกเบี้ยค้างจ่าย'),
  ('d9d9e200-0000-0000-0000-0000000000e6','d9d9e200-0000-0000-0000-0000000000d3',2,
   '5512109','ดอกเบี้ยจ่าย-PN',0,19863.01,'กลับรายการค่าใช้จ่ายดอกเบี้ย');

-- ⑤ ตรวจผล
select pn.pn_number, pn.status, pn.accrued_interest,
       (select count(*) from journal_entries j
         where j.source_type='PN_ACCRUED' and j.source_id=pn.id
           and j.status='Posted' and j.is_reversal=false) as accrued_je_count
  from promissory_notes pn where pn.id='d9d9e200-0000-0000-0000-0000000000a1';
-- คาดหวัง: accrued_je_count = 1 → ตอนตัดดอกเบี้ย ระบบ Dr 2197109 "ล้างดอกเบี้ยค้างจ่าย" (ไม่ใช่ 5512103)
