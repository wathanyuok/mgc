-- ============================================================
-- Seed: FX-64 / FR-FXF-002 — ปิด L/C ด้วยอัตราตามสัญญา FX Forward ที่ผูกไว้
--
--   สร้าง FXF-FXF64 (Active · forward 35.00) + LC-FXF64 (Active) ที่ผูก reference_fxf_id = FXF-FXF64
--   ไว้ทดสอบว่าเลือก "FX Contract Rate" ตอนปิด L/C แล้ว SETTLEMENT FX RATE เติมเป็น 35.0000 อัตโนมัติ
--
-- วิธีทดสอบ FX-64:
--   1. เปิด LC-FXF64 → ช่อง FX FORWARD (Hedge Reference) ต้องผูก FXF-FXF64 อยู่แล้ว (จาก seed)
--   2. ไปส่วนปิด L/C → "อัตราแลกเปลี่ยน (ใช้ตอนปิด LC)" เลือก "FX Contract Rate"
--   3. ดูช่อง SETTLEMENT FX RATE
--   ผล: เติมอัตโนมัติ = forward_rate ของ FXF-FXF64 = 35.0000
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('LC_FEE','LC_FEE_RECOG','LC_SETTLEMENT')
   and source_id = 'd9d9e270-0000-0000-0000-000000000125';
delete from letters_of_credit where id = 'd9d9e270-0000-0000-0000-000000000125' or lc_no = 'LC-FXF64';
delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-000000000124';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-000000000124' or fxf_no = 'FXF-FXF64';
delete from credit_agreements where id in ('d9d9e270-0000-0000-0000-000000000122','d9d9e270-0000-0000-0000-000000000123')
   or contract_number in ('CA-FXF64-FXF','CA-FXF64-LC');
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000121';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000121' or ma_name = 'MA-FXF64-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000121','BBL','MA-FXF64-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 40000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000121','MGC',40000000,0,0);

-- ② CA วงเงิน FX Forward
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000122','d9d9e270-0000-0000-0000-000000000121',
   'CA-FXF64-FXF (วงเงิน FX Forward)', 'CA-FXF64-FXF', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ CA วงเงิน L/C
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000123','d9d9e270-0000-0000-0000-000000000121',
   'CA-FXF64-LC (วงเงิน L/C)', 'CA-FXF64-LC', 'MGC',
   (select id from facility_types where code='LC' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ④ FXF (Active · forward 35.00 → ขึ้นใน dropdown Hedge ของ L/C)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000124','FXF-FXF64','FXF-FXF64 (Hedge ของ LC-FXF64)',
   'd9d9e270-0000-0000-0000-000000000122','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-12-31', date '2026-12-31',
   183, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-64 · เป็น Hedge Reference ของ LC-FXF64 · forward 35.00 ไว้ auto-fill อัตราปิด', now(), now());

-- ⑤ L/C (Active · ผูก reference_fxf_id = FXF-FXF64)
insert into letters_of_credit
  (id, lc_no, name, ca_id, finance_institution, lc_type, beneficiary, applicant,
   currency, amount_foreign, conversion_rate, amount,
   issue_date, expiry_date, transaction_date, term_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   reference_fxf_id, reference_contract, shared_limit_with_tr,
   status, rate_cards, acct_cards, created_by, updated_by, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000125','LC-FXF64','LC-FXF64 (ปิดด้วยอัตราตามสัญญา FXF)',
   'd9d9e270-0000-0000-0000-000000000123','BBL','LC','Supplier Co., Ltd.','MGC',
   'USD', 100000, 34.800000, 3480000,
   date '2026-07-10', date '2026-12-31', date '2026-07-10', 174,
   'full_term', 1.48, 0, 0,
   'd9d9e270-0000-0000-0000-000000000124', 'PO-FXF64-REF', true,
   'Active', '[]'::jsonb, '[]'::jsonb, 'seed', 'seed', now(), now());

-- ⑥ ใบค่าธรรมเนียม Upfront (LC_FEE · Posted) — จำเป็นต่อ hasUpfrontJE ปุ่ม Pay & Close ถึงจะกดได้
--    ค่าธรรมเนียม = 3,480,000 × 1.48% = 51,504.00 บาท (full_term)
update letters_of_credit set fee_amount = 51504 where id = 'd9d9e270-0000-0000-0000-000000000125';
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, description, total_dr, total_cr,
   status, posted_by, posted_at, is_reversal, remark)
values
  ('d9d9e270-0000-0000-0000-00000000012a', next_je_number(), 'LC_FEE',
   'd9d9e270-0000-0000-0000-000000000125', 0, date '2026-07-10',
   'LC-FXF64 — ค่าธรรมเนียม L/C (Upfront)', 51504, 51504,
   'Posted', 'seed', now(), false, 'ค่าธรรมเนียม L/C แรกเข้า (Prepaid) — seed FX-64');
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e270-0000-0000-0000-00000000012a', 1, '5511101', 'ค่าธรรมเนียมธนาคาร',          51504, 0, 'ค่าธรรมเนียม L/C (Upfront) — LC-FXF64'),
  ('d9d9e270-0000-0000-0000-00000000012a', 2, '1001201', 'C/A - BBL#181-3-11063-0',      0, 51504, 'จ่ายค่าธรรมเนียมจากบัญชีธนาคาร — LC-FXF64');

-- ⑦ ตรวจผล: L/C ผูกกับ FXF ที่ Active และ forward_rate ที่จะถูก auto-fill
select l.lc_no, l.status as lc_status, f.fxf_no, f.status as fxf_status,
       f.forward_rate as auto_fill_rate
  from letters_of_credit l
  join fx_forwards f on f.id = l.reference_fxf_id
 where l.id = 'd9d9e270-0000-0000-0000-000000000125';
-- คาดหวัง: LC-FXF64 (Active) ↔ FXF-FXF64 (Active) · auto_fill_rate = 35.000000
