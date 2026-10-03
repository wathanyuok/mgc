-- ============================================================
-- Seed: RP-64 — กลับรายการใบตัดชำระแล้ววงเงินกลับเป็นเดิม
-- ลำดับให้สมเหตุผล: เบิกเงิน (Drawdown) → จ่ายคืนเงินต้น 4 ล้าน → ไป Reverse ใบ JE → วงเงินกลับ
--
-- ชุดข้อมูล (self-contained):
--   • CA-RP64-DEMO   วงเงิน Revolving 10,000,000
--   • PN-RP64        ตั๋ว 10,000,000 (Active) ใต้ CA  — เป็น bullet: เงินต้นคืนทีเดียวตอนครบกำหนด
--   • JE เบิกเงิน (PN_DRAWDOWN, Posted)  : Dr เงินฝาก 1001201 / Cr ตั๋วเงินจ่าย 2142101  (PN จึง "ลงบัญชีแล้ว")
--   • ใบตัดชำระ RP-RP64-001 (Posted) จ่ายคืนเงินต้น 4,000,000 + JE (REPAYMENT, Posted)
--
-- หมายเหตุ: PN เป็น bullet ตารางงวด (Schedule Calculate) ระบบคำนวณเองจาก amount (เงินต้นคงที่ 10 ล้าน)
--   จึงไม่ seed installment_schedules เอง (ถ้าใส่เงินต้นรายงวดจะขัดกับตารางจริง)
--   "ยอดที่หน้าสัญญาหลัก" ที่ต้องกลับ = ยอดใช้วงเงิน (Utilization) ที่ระดับ CA/วงเงิน
--
-- สถานะเริ่มต้น (หลังจ่ายคืน 4 ล้าน · ก่อน Reverse):
--   CA Utilization = 10,000,000 − 4,000,000 = 6,000,000  ·  คงเหลือ 4,000,000
-- หลัง Reverse JE-RP64-001 (โค้ด reverseJE ที่แก้แล้ว):
--   repayment → Reversed → trigger คำนวณใหม่ → Utilization กลับเป็น 10,000,000 · คงเหลือ 0
--
-- FIELD ครบ · รันซ้ำได้ (ลบของเดิมก่อน)
-- ============================================================

-- ── ลบของเดิม (ตามลำดับ dependency) ──
delete from installment_schedules where facility_id = 'd9d9d000-0000-0000-0000-0000000000a1';
delete from je_lines where je_id in ('d9d9d000-0000-0000-0000-0000000000d1','d9d9d000-0000-0000-0000-0000000000a2');
delete from repayment_lines where repayment_id = 'd9d9d000-0000-0000-0000-0000000000b1';
delete from repayments where id = 'd9d9d000-0000-0000-0000-0000000000b1';
delete from journal_entries where id in ('d9d9d000-0000-0000-0000-0000000000d1','d9d9d000-0000-0000-0000-0000000000a2');
delete from promissory_notes where id = 'd9d9d000-0000-0000-0000-0000000000a1';
delete from credit_agreements where id = 'd9d9d000-0000-0000-0000-0000000000c1';
delete from ma_subsidiaries where ma_id = 'd9d9d000-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9d000-0000-0000-0000-0000000000c2' or ma_name = 'MA-RP64-DEMO';

-- ①a MA — สัญญาหลัก (วงเงิน 10 ล้าน) ให้ CA ผูก (ไม่งั้นช่อง MASTER AGREEMENT ว่าง)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9d000-0000-0000-0000-0000000000c2','BBL','MA-RP64-DEMO','MGC','Approved',
   date '2026-09-01', date '2027-08-31', 10000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9d000-0000-0000-0000-0000000000c2','MGC',10000000,0,0);

-- ①b CA — วงเงิน Revolving 10 ล้าน (ผูก MA ด้านบน)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9d000-0000-0000-0000-0000000000c1',
   'd9d9d000-0000-0000-0000-0000000000c2',
   'CA-RP64-DEMO (วงเงิน PN 10 ล้าน · Revolving)', 'CA-RP64-DEMO', 'MGC',
   (select id from facility_types where code='PN' limit 1),
   10000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ② PN — ตั๋ว 10 ล้าน (Active · เบิกเงินแล้ว)
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id, transaction_date, maturity_date,
   term_days, amount, currency, effective_rate, reference_contract, status, remark,
   rate_cards, acct_cards, chassis_list, accrued_interest, created_at, updated_at)
values
  ('d9d9d000-0000-0000-0000-0000000000a1','PN-RP64','PN-RP64',
   'd9d9d000-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-09-01', date '2026-12-01', 91, 10000000, 'THB', 5.0,
   'REF-RP64', 'Active', 'seed RP-64 · ตั๋ว 10 ล้าน (เบิกเงินแล้ว) ไว้ทดสอบ reverse ใบตัดชำระ',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, 0, now(), now());

-- ③ JE เบิกเงิน (PN_DRAWDOWN · Posted) — Dr เงินฝาก / Cr ตั๋วเงินจ่าย  → PN "ลงบัญชีวันเบิกเงินแล้ว"
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9d000-0000-0000-0000-0000000000a2','JE-RP64-DRAW','PN_DRAWDOWN',
   'd9d9d000-0000-0000-0000-0000000000a1', 0, date '2026-09-01','Sep 2026',
   'Drawdown PN-RP64 — เบิกเงิน 10,000,000', 10000000, 10000000, 'Posted',
   'seed', now(), false, 'seed RP-64 · เบิกเงินวันแรก', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9d000-0000-0000-0000-0000000000e3','d9d9d000-0000-0000-0000-0000000000a2',1,
   '1001201','C/A - BBL#181-3-11063-0',10000000,0,'เงินฝากจากการเบิก PN-RP64'),
  ('d9d9d000-0000-0000-0000-0000000000e4','d9d9d000-0000-0000-0000-0000000000a2',2,
   '2142101','เงินกู้ยืมระยะสั้น-สถาบันการเงิน',0,10000000,'ตั๋วเงินจ่าย-P/N');

-- ④ JE ของใบตัดชำระ (REPAYMENT · Posted) — Dr ตั๋วเงินจ่าย / Cr เงินฝาก (จ่ายคืนเงินต้น 4M)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9d000-0000-0000-0000-0000000000d1','JE-RP64-001','REPAYMENT',
   'd9d9d000-0000-0000-0000-0000000000b1', 1, date '2026-10-01','Oct 2026',
   'Repayment PN-RP64 — จ่ายคืนเงินต้น 4,000,000', 4000000, 4000000, 'Posted',
   'seed', now(), false, 'seed RP-64 · ใบตัดชำระต้น 4 ล้าน', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9d000-0000-0000-0000-0000000000e1','d9d9d000-0000-0000-0000-0000000000d1',1,
   '2142101','เงินกู้ยืมระยะสั้น-สถาบันการเงิน',4000000,0,'ตัดเงินต้น PN-RP64'),
  ('d9d9d000-0000-0000-0000-0000000000e2','d9d9d000-0000-0000-0000-0000000000d1',2,
   '1001201','C/A - BBL#181-3-11063-0',0,4000000,'จ่ายจากเงินฝาก');

-- ⑤ ใบตัดชำระ (Posted) · จ่ายคืนเงินต้น 4 ล้าน · ผูก JE
insert into repayments
  (id, repayment_no, facility_type_id, facility_id, pay_date, amount, principal, interest, fee, vat, wht, penalty,
   channel, reference_no, remark, status, je_id, created_at, updated_at)
values
  ('d9d9d000-0000-0000-0000-0000000000b1','RP-RP64-001',(select id from facility_types where code='PN' limit 1),
   'd9d9d000-0000-0000-0000-0000000000a1', date '2026-10-01', 4000000, 4000000, 0, 0, 0, 0, 0,
   'Bank Statement','REF-RP64-PAY','seed RP-64 · จ่ายคืนเงินต้น 4 ล้าน (ไว้ทดสอบ Reverse)', 'Posted',
   'd9d9d000-0000-0000-0000-0000000000d1', now(), now());

-- ⑥ รายการจ่าย (Principal 4 ล้าน) — ตัวที่ trigger ใช้คำนวณวงเงิน (facility_type = 'PN' ให้ตรง 0102)
insert into repayment_lines
  (id, repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order)
values
  ('d9d9d000-0000-0000-0000-0000000000f1','d9d9d000-0000-0000-0000-0000000000b1','PN',
   'd9d9d000-0000-0000-0000-0000000000a1','PN-RP64','Principal', 4000000, 0);

-- ⑦ ตรวจผลเริ่มต้น (ก่อน Reverse)
select 'PN' as m, pn_number, status, amount,
       amount - coalesce((select sum(rl.amount) from repayment_lines rl
                            join repayments r on r.id=rl.repayment_id
                           where rl.facility_id='d9d9d000-0000-0000-0000-0000000000a1'
                             and rl.category='Principal' and r.status='Posted'),0) as used_after_repay
  from promissory_notes where id='d9d9d000-0000-0000-0000-0000000000a1';
-- คาดหวังก่อน Reverse: used_after_repay = 6,000,000 (คงเหลือ 4,000,000)
-- หลัง Reverse JE-RP64-001: repayment → Reversed → used กลับ 10,000,000 (คงเหลือ 0)
