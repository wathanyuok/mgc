-- ============================================================
-- Seed: RP-16 — ใบตัดชำระเก่าที่สัญญาต้นทางถูกปิดไปแล้ว
-- เปิดใบตัดชำระนี้ → ช่อง Contract ต้องยังโชว์สัญญาเดิม + กำกับ "(สัญญาจบแล้ว)" ไม่กลายเป็นช่องว่าง
--
--   • CA-RP16-DEMO   วงเงิน PN
--   • PN-RP16        ตั๋ว 5,000,000 · status = Repaid (ปิด/จ่ายครบแล้ว)  ← สัญญาจบแล้ว
--   • ใบตัดชำระ RP-RP16-001 (Posted) จ่ายคืนเงินต้น 5,000,000 + JE · ผูกกับ PN-RP16
--
-- วิธีทดสอบ:
--   1. เมนู Payments → Repayment → เปิดใบ RP-RP16-001
--   2. ดูตาราง Payment Allocation ช่อง CONTRACT (PN)
--   ผล: ช่องโชว์ "PN-RP16 · (สัญญาจบแล้ว)" (ไม่ว่าง) เพราะ PN ถูกปิด (Repaid) เลยไม่อยู่ใน dropdown
--       แต่ระบบดึง facility_id เดิมมาแสดงพร้อมกำกับให้
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from je_lines where je_id = 'd9d9e170-0000-0000-0000-0000000000d1';
delete from repayment_lines where repayment_id = 'd9d9e170-0000-0000-0000-0000000000b1';
delete from repayments where id = 'd9d9e170-0000-0000-0000-0000000000b1';
delete from journal_entries where id = 'd9d9e170-0000-0000-0000-0000000000d1';
delete from promissory_notes where id = 'd9d9e170-0000-0000-0000-0000000000a1';
delete from credit_agreements where id = 'd9d9e170-0000-0000-0000-0000000000c1';
delete from ma_subsidiaries where ma_id = 'd9d9e170-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e170-0000-0000-0000-0000000000c2' or ma_name = 'MA-RP16-DEMO';

-- ①a MA — สัญญาหลัก (ให้ CA ผูก)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e170-0000-0000-0000-0000000000c2','BBL','MA-RP16-DEMO','MGC','Approved',
   date '2026-09-01', date '2027-08-31', 10000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e170-0000-0000-0000-0000000000c2','MGC',10000000,0,0);

-- ①b CA (ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9e170-0000-0000-0000-0000000000c1',
   'd9d9e170-0000-0000-0000-0000000000c2',
   'CA-RP16-DEMO (วงเงิน PN)', 'CA-RP16-DEMO', 'MGC',
   (select id from facility_types where code='PN' limit 1),
   10000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ② PN — ปิดแล้ว (Repaid)
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id, transaction_date, maturity_date,
   term_days, amount, currency, effective_rate, reference_contract, status, remark,
   rate_cards, acct_cards, chassis_list, accrued_interest, created_at, updated_at)
values
  ('d9d9e170-0000-0000-0000-0000000000a1','PN-RP16','PN-RP16',
   'd9d9e170-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-06-01', date '2026-09-01', 92, 5000000, 'THB', 5.0,
   'REF-RP16', 'Repaid', 'seed RP-16 · ตั๋วที่จ่ายครบปิดสัญญาแล้ว (Repaid)',
   '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, now(), now());

-- ③ JE ของใบตัดชำระ (REPAYMENT · Posted)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e170-0000-0000-0000-0000000000d1','JE-RP16-001','REPAYMENT',
   'd9d9e170-0000-0000-0000-0000000000b1', 1, date '2026-09-01','Sep 2026',
   'Repayment PN-RP16 — จ่ายคืนเงินต้น 5,000,000 (ปิดสัญญา)', 5000000, 5000000, 'Posted',
   'seed', now(), false, 'seed RP-16', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e170-0000-0000-0000-0000000000e1','d9d9e170-0000-0000-0000-0000000000d1',1,
   '2142101','เงินกู้ยืมระยะสั้น-สถาบันการเงิน',5000000,0,'ตัดเงินต้น PN-RP16'),
  ('d9d9e170-0000-0000-0000-0000000000e2','d9d9e170-0000-0000-0000-0000000000d1',2,
   '1001201','C/A - BBL#181-3-11063-0',0,5000000,'จ่ายจากเงินฝาก');

-- ④ ใบตัดชำระ (Posted)
insert into repayments
  (id, repayment_no, facility_type_id, facility_id, pay_date, amount, principal, interest, fee, vat, wht, penalty,
   channel, reference_no, remark, status, je_id, created_at, updated_at)
values
  ('d9d9e170-0000-0000-0000-0000000000b1','RP-RP16-001',(select id from facility_types where code='PN' limit 1),
   'd9d9e170-0000-0000-0000-0000000000a1', date '2026-09-01', 5000000, 5000000, 0, 0, 0, 0, 0,
   'Bank Statement','REF-RP16-PAY','seed RP-16 · ใบตัดชำระของสัญญาที่ปิดแล้ว', 'Posted',
   'd9d9e170-0000-0000-0000-0000000000d1', now(), now());

-- ⑤ รายการจ่าย — contract_label เก็บชื่อสัญญาไว้ (ใช้แสดงตอนสัญญาจบแล้ว)
insert into repayment_lines
  (id, repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order)
values
  ('d9d9e170-0000-0000-0000-0000000000f1','d9d9e170-0000-0000-0000-0000000000b1','PN',
   'd9d9e170-0000-0000-0000-0000000000a1','PN-RP16','Principal', 5000000, 0);

-- ⑥ ตรวจผล
select r.repayment_no, r.status as repayment_status,
       pn.pn_number, pn.status as pn_status,
       rl.contract_label
  from repayments r
  join repayment_lines rl on rl.repayment_id = r.id
  join promissory_notes pn on pn.id = rl.facility_id
 where r.id = 'd9d9e170-0000-0000-0000-0000000000b1';
-- คาดหวัง: pn_status = Repaid → เปิดใบ RP-RP16-001 แล้วช่อง Contract โชว์ "PN-RP16 · (สัญญาจบแล้ว)"
