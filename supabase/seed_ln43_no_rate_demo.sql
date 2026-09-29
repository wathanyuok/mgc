-- ============================================================
-- Seed: LN-43 — Loan ที่ "ไม่ใส่อัตราดอกเบี้ย" (ไม่มี Rate Card) · FIELD ครบทุกช่อง
-- สาย MA → CA → Loan · ใช้ทดสอบพฤติกรรมเมื่อไม่มีอัตรา
--
-- เงื่อนไขทดสอบ (สำคัญ): rate_cards = [] (ว่าง) → annual_rate = 0
--   คาดผลจริง: ตารางผ่อน "ยังแสดง" เป็นดอกเบี้ย 0 ทุกงวด · ค่างวด = เงินต้น ÷ จำนวนงวด
--             · EFFECTIVE INTEREST RATE / YEAR = 0.0000% · ไม่มีคำเตือน · บันทึกได้
--   (ถ้า requirement ต้องเตือน+ซ่อนตาราง = ช่องว่างที่ต้องเพิ่ม guard)
--
-- Loan (Draft) · เงินต้น 1,000,000 · TERM 24 เดือน · Fix Installment · Grace 0
-- ผูก CREDIT AGREEMENT (required) ครบ · acct_cards ครบ 4 role (ตรง JE Default ของ Loan)
-- รันซ้ำได้ (ลบ Loan ก่อน · MA/CA ใช้ upsert)
-- ============================================================

-- ลบ Loan เดิม (ทั้ง loan_no + id)
delete from loans
 where loan_no = 'LN-DEMO-NORATE-043'
    or id = 'd9d94300-0000-0000-0000-000000000043';

-- ① MA · ครบทุก field (remaining_credit = generated column · ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d94300-0000-0000-0000-0000000000a1', 'MA-DEMO-LN43', 'BBL', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 1000000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed LN-43 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'd9d94300-0000-0000-0000-0000000000a1';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d94300-0000-0000-0000-0000000000a1', 'MGC', 50000000, 1000000, 0);

-- ② CA · ประเภท Loan · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d94300-0000-0000-0000-0000000000c1', 'CA เดโม — วงเงินเงินกู้ (LN-43)', 'CA-DEMO-LN43',
   'd9d94300-0000-0000-0000-0000000000a1', 'MGC',
   (select id from facility_types where code = 'LOAN' limit 1),
   20000000, 1000000, 'THB', 'Term', 'BBL',
   false, 0, 0,
   'วงเงินเงินกู้ระยะยาว (Term Loan)', 'REF-CA-LN43-2026',
   'seed LN-43 · CA วงเงิน Loan', 'ค้ำโดยบริษัทแม่ MGC',
   '[]'::jsonb,
   '[
      {"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
      {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
      {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},
      {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}
    ]'::jsonb,
   date '2026-01-01', date '2027-12-31', 'Approved',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ca_name = excluded.ca_name, contract_number = excluded.contract_number,
  ma_id = excluded.ma_id, subsidiary = excluded.subsidiary,
  facility_type_id = excluded.facility_type_id,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  currency = excluded.currency, credit_type = excluded.credit_type,
  finance_institution = excluded.finance_institution,
  curtailment_option = excluded.curtailment_option, rollover_max_times = excluded.rollover_max_times,
  rollover_max_days = excluded.rollover_max_days, loan_purpose = excluded.loan_purpose,
  reference_contract = excluded.reference_contract, remark = excluded.remark,
  guarantee_remark = excluded.guarantee_remark, rate_cards = excluded.rate_cards,
  acct_cards = excluded.acct_cards, start_date = excluded.start_date,
  end_date = excluded.end_date, status = excluded.status, updated_at = now();

-- ③ Loan · ครบทุก field · rate_cards = [] (ไม่มีอัตรา = เงื่อนไขทดสอบ LN-43)
insert into loans
  (id, loan_no, name, ca_id, finance_institution, po_ref,
   principal, amount, amount_foreign, conversion_date, conversion_rate, currency,
   annual_rate, term_months, start_date, end_date, transaction_date,
   installment_start_date, installment_end_date, pay_eom, payment_timing, payment_type,
   grace_months, installment, residual_value, include_rv_in_installment,
   step_period, step_residual, balloon_option, effective_rate, irr_month,
   allow_prepayment, prepayment_fee_base, rollover_parent_id, payment_freq,
   status, closed_at, closed_reason, remark,
   rate_cards, acct_cards, bank_ref, created_at, updated_at)
values
  ('d9d94300-0000-0000-0000-000000000043', 'LN-DEMO-NORATE-043', 'เงินกู้เดโม — ไม่ใส่อัตราดอกเบี้ย (LN-43)',
   'd9d94300-0000-0000-0000-0000000000c1', 'BBL', 'PO-LN43-DEMO',
   1000000, 1000000, null, null, null, 'THB',
   0,                                   -- annual_rate = 0 (ไม่มีอัตรา)
   24, date '2026-09-01', date '2028-09-29', date '2026-09-01',
   date '2026-09-30', date '2028-09-29', true, 'arrears', 'Fix Installment / Fix Installment & Step payment',
   0, null, 0, true,
   null, null, null, 0, null,
   'Yes — รองรับทั้ง Full + Partial', 'Outstanding Principal (หนี้คงเหลือ)', null, 'Monthly',
   'Draft', null, null, 'seed LN-43 · Loan ไม่มี Rate Card (annual_rate=0) · ตารางจะแสดงดอกเบี้ย 0 ทุกงวด',
   '[]'::jsonb,                          -- rate_cards ว่าง = ไม่มีอัตรา (เงื่อนไขทดสอบหลัก)
   '[
      {"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
      {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
      {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},
      {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}
    ]'::jsonb,
   'BANKREF-LN43', now(), now());

-- ตรวจผล
select loan_no, status, principal, term_months, annual_rate,
       jsonb_array_length(rate_cards) as rate_card_count,
       installment
  from loans
 where loan_no = 'LN-DEMO-NORATE-043';
