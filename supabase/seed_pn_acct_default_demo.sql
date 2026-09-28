-- ============================================================
-- Seed: P/N — acct_cards = ค่าตั้งต้น (default) · สาย MA → CA → PN · FIELD ครบทุกช่อง
-- ใช้พิสูจน์ว่า JE ที่ลงตรงกับ "JE Default sheet" ของ P/N เป๊ะ
--
-- P/N (Active) · เงินต้น 1,000,000 · 5% Fixed · 01/09/2026 → 01/12/2026 (91 วัน)
-- ผูก CREDIT AGREEMENT (required) ครบ · ยังไม่ลงใบสำคัญ → กดลงบัญชีได้ทันที
--
-- acct_cards default 4 role (ตรง JE Default):
--   CASH / BANK 1001201 · NOTE PAYABLE 2142101 · INTEREST EXPENSE 5512109 · ACCRUED INTEREST 2197109
--
-- ตรวจ: เบิกเงิน → Dr 1001201 / Cr 2142101 · ดอกเบี้ยงวด → Dr 5512109 / Cr 2197109
-- รันซ้ำได้ (ลบ PN ก่อน · MA/CA ใช้ upsert)
-- ============================================================

-- ลบ PN เดิม (ทั้ง pn_number + id)
delete from promissory_notes
 where pn_number = 'PN-DEMO-ACCT-DEF-001'
    or id = 'd9d90000-0000-0000-0000-00000000d1d1';

-- ① MA · ครบทุก field (remaining_credit = generated column · ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000a1', 'MA-DEMO-PNDEF', 'BBL', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 1000000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed PN-DEF · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'd9d90000-0000-0000-0000-0000000000a1';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d90000-0000-0000-0000-0000000000a1', 'MGC', 50000000, 1000000, 0);

-- ② CA · ประเภท PN · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000c1', 'CA เดโม — วงเงินตั๋วสัญญาใช้เงิน (PN-DEF)', 'CA-DEMO-PNDEF',
   'd9d90000-0000-0000-0000-0000000000a1', 'MGC',
   (select id from facility_types where code = 'PN' limit 1),
   20000000, 1000000, 'THB', 'Revolving', 'BBL',
   false, 4, 360,
   'วงเงินตั๋วสัญญาใช้เงิน (P/N) เพื่อหมุนเวียน', 'REF-CA-PNDEF-2026',
   'seed PN-DEF · CA วงเงิน P/N', 'ค้ำโดยบริษัทแม่ MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[
      {"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
      {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
      {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},
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
  guarantee_remark = excluded.guarantee_remark,
  rate_cards = excluded.rate_cards, acct_cards = excluded.acct_cards,
  start_date = excluded.start_date, end_date = excluded.end_date, status = excluded.status,
  updated_at = now();

-- ③ P/N · Active · ครบทุก field (facility_type ถูก drop แล้ว ใช้ facility_type_id · ผูก ca_id)
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id,
   transaction_date, maturity_date, term_days, amount, currency,
   interest_rate_id, effective_rate, reference_contract, po_ref,
   status, remark,
   rate_cards, acct_cards, chassis_list,
   rollover_parent_id, reference_transaction_id, accrued_interest,
   created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-00000000d1d1',
   'PN-DEMO-ACCT-DEF', 'PN-DEMO-ACCT-DEF-001',
   'd9d90000-0000-0000-0000-0000000000c1', 'BBL',
   (select id from facility_types where code = 'PN' limit 1),
   date '2026-09-01', date '2026-12-01', 91, 1000000, 'THB',
   null, 5.0000, 'REF-PN-DEF-2026', 'PO-2026-PNDEF01',
   'Active', 'seed · PN acct_cards = default (ตรง JE Default sheet)',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[
      {"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
      {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
      {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},
      {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}
    ]'::jsonb,
   '[]'::jsonb, null, null, 0,
   now(), now());

-- ตรวจ: เปิด PN-DEMO-ACCT-DEF-001 → CREDIT AGREEMENT NAME = CA-DEMO-PNDEF (ผูกครบ)
--   แท็บ Accounting เห็นการ์ด 4 ใบ (รหัส default)
--   Schedule Calculate → "📋 ลงบัญชีวันเบิกเงิน" → Dr 1001201 / Cr 2142101
--   → "📋 ลงบัญชีงวดนี้" (งวดมีดอกเบี้ย) → Dr 5512109 / Cr 2197109  (ตรง JE Default)
