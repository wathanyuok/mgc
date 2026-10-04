-- ============================================================
-- Seed: FX-65 — L/C ที่ยังไม่ผูกสัญญา → เลือก "FX Contract Rate" ไม่ได้
--
--   สร้าง LC-FXF65 (Active · Fee Upfront ลงแล้ว) ที่ reference_fxf_id = NULL (ไม่ผูก FXF)
--   ไว้ทดสอบว่า ใน Pay & Close ตัวเลือก "FX Contract Rate" ถูก disable + ขึ้น "— ยังไม่ผูก FX Forward"
--
-- วิธีทดสอบ FX-65:
--   1. เปิด LC-FXF65 → แท็บ References → ช่อง FX FORWARD (Hedge Reference) ต้องว่าง
--   2. กดปุ่ม "✓ Pay & Close" → ใน dropdown "อัตราแลกเปลี่ยน (ใช้ตอนปิด LC)" ลองเลือก "FX Contract Rate"
--   ผล: ตัวเลือกกดไม่ได้ (disabled) + ข้อความ "— ยังไม่ผูก FX Forward" · เลือกได้แค่ "Spot Rate (ณ วันปิด)"
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('LC_FEE','LC_FEE_RECOG','LC_SETTLEMENT')
   and source_id = 'd9d9e270-0000-0000-0000-000000000135';
delete from letters_of_credit where id = 'd9d9e270-0000-0000-0000-000000000135' or lc_no = 'LC-FXF65';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000133' or contract_number = 'CA-FXF65-LC';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000131';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000131' or ma_name = 'MA-FXF65-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000131','BBL','MA-FXF65-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000131','MGC',20000000,0,0);

-- ② CA วงเงิน L/C
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000133','d9d9e270-0000-0000-0000-000000000131',
   'CA-FXF65-LC (วงเงิน L/C)', 'CA-FXF65-LC', 'MGC',
   (select id from facility_types where code='LC' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ L/C (Active · reference_fxf_id = NULL → ไม่ผูกสัญญา)
insert into letters_of_credit
  (id, lc_no, name, ca_id, finance_institution, lc_type, beneficiary, applicant,
   currency, amount_foreign, conversion_rate, amount,
   issue_date, expiry_date, transaction_date, term_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   reference_fxf_id, reference_contract, shared_limit_with_tr,
   status, rate_cards, acct_cards, created_by, updated_by, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000135','LC-FXF65','LC-FXF65 (ยังไม่ผูก FX Forward)',
   'd9d9e270-0000-0000-0000-000000000133','BBL','LC','Supplier Co., Ltd.','MGC',
   'USD', 100000, 34.800000, 3480000,
   date '2026-07-10', date '2026-12-31', date '2026-07-10', 174,
   'full_term', 1.48, 0, 51504,
   NULL, 'PO-FXF65-REF', true,
   'Active', '[]'::jsonb, '[]'::jsonb, 'seed', 'seed', now(), now());

-- ④ ใบค่าธรรมเนียม Upfront (LC_FEE · Posted) — ให้ปุ่ม Pay & Close กดได้
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, description, total_dr, total_cr,
   status, posted_by, posted_at, is_reversal, remark)
values
  ('d9d9e270-0000-0000-0000-00000000013a', next_je_number(), 'LC_FEE',
   'd9d9e270-0000-0000-0000-000000000135', 0, date '2026-07-10',
   'LC-FXF65 — ค่าธรรมเนียม L/C (Upfront)', 51504, 51504,
   'Posted', 'seed', now(), false, 'ค่าธรรมเนียม L/C แรกเข้า (Prepaid) — seed FX-65');
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e270-0000-0000-0000-00000000013a', 1, '5511101', 'ค่าธรรมเนียมธนาคาร',     51504, 0, 'ค่าธรรมเนียม L/C (Upfront) — LC-FXF65'),
  ('d9d9e270-0000-0000-0000-00000000013a', 2, '1001201', 'C/A - BBL#181-3-11063-0', 0, 51504, 'จ่ายค่าธรรมเนียมจากบัญชีธนาคาร — LC-FXF65');

-- ⑤ ตรวจผล: L/C Active · ไม่ผูก FXF (reference_fxf_id ต้องเป็น NULL)
select lc_no, status, reference_fxf_id,
       case when reference_fxf_id is null then '✅ ไม่ผูก → FX Contract Rate ต้อง disable'
            else '❌ มีการผูกอยู่' end as check_result
  from letters_of_credit where id = 'd9d9e270-0000-0000-0000-000000000135';
-- คาดหวัง: LC-FXF65 · Active · reference_fxf_id = NULL
