-- ============================================================
-- Seed: FX-28 — รหัสบัญชีที่ใช้ในใบสำคัญ มีอยู่ในผังบัญชีไหม
--
--   ตั้งสัญญา FXF (Active) + ใบสำคัญตีราคา "ที่ลงบัญชีแล้ว" 1 ใบ พร้อมใบกลับรายการ
--   เพื่อให้ผู้ทดสอบเปิดใบสำคัญอ่านรหัสบัญชีได้ทันที แล้วไปค้นในเมนูผังบัญชี
--
--   ใช้บัญชี default (ไม่ผูก acct_cards) → รหัสที่ปรากฏในใบสำคัญ:
--     กรณี seed นี้ = ขาดทุน (spot 34.50 < forward 35.00)
--       Dr 5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา   (ผังบัญชี: All)
--       Cr 2391101 หนี้สินตราสารอนุพันธ์ - Current portion       (ผังบัญชี: XMT ⚠️)
--     (ฝั่งกำไรจะใช้ 1191999 / 4929103 ซึ่งเป็น All ทั้งคู่)
--
--   ผลต่าง = 100,000 × (34.50 − 35.00) = -50,000.00
--
-- วิธีทดสอบ FX-28:
--   1. เปิดเมนูสมุดรายวัน (JE) → หาใบ "ตีราคาสัญญาซื้อขายเงินตราล่วงหน้า — FXF-FXF28"
--   2. จดรหัสบัญชีทุกบรรทัด (Dr/Cr)
--   3. ไปเมนูผังบัญชี → ค้นหารหัสทีละตัว
--   ผล: รหัสทุกตัวค้นเจอในผังบัญชี
--   ⚠️ ค้น 2391101 แล้วดูคอลัมน์บริษัท — ตอนนี้ขึ้น XMT ไม่ใช่ MGC/All
--      ถ้าต้องผูกกับบริษัทของสัญญา (MGC) ให้ถือว่าข้อนี้ fail แล้วแก้ผังบัญชีก่อน
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (ใบสำคัญ + ใบกลับรายการ + lines ผ่าน cascade)
delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-0000000000f8';
delete from fx_valuations where fxf_id = 'd9d9e270-0000-0000-0000-0000000000f8';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000f8' or fxf_no = 'FXF-FXF28';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000f6' or contract_number = 'CA-FXF28-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000f7';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000f7' or ma_name = 'MA-FXF28-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000f7','BBL','MA-FXF28-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000f7','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards = [] → ใบสำคัญตก default)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000f6','d9d9e270-0000-0000-0000-0000000000f7',
   'CA-FXF28-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF28-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb, '[]'::jsonb);

-- ③ FXF (Active · acct_cards = [])
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f8','FXF-FXF28','FXF-FXF28 (ตรวจรหัสบัญชีในผังบัญชี)',
   'd9d9e270-0000-0000-0000-0000000000f6','BBL',
   date '2026-09-01', date '2026-09-01', date '2026-12-31', date '2026-12-31',
   121, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-28 · ใบสำคัญตีราคาใช้บัญชี default → ตรวจว่ามีในผังบัญชีครบ', now(), now());

-- ④ fx_valuation งวด 2026-09-30 (ขาดทุน 50,000) สถานะ Posted
insert into fx_valuations
  (id, fxf_id, valuation_date, month_end_rate, contract_rate, notional_amount, notional_thb, mtm_thb, status, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000fa','d9d9e270-0000-0000-0000-0000000000f8',
   date '2026-09-30', 34.500000, 35.000000, 100000, 3500000, -50000, 'Draft', now(), now());

-- ⑤ ใบสำคัญตีราคา (Posted) — ขาดทุน: Dr 5439907 / Cr 2391101
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, description, total_dr, total_cr,
   status, posted_by, posted_at, is_reversal, remark)
values
  ('d9d9e270-0000-0000-0000-0000000000fb', next_je_number(), 'FX_VALUATION',
   'd9d9e270-0000-0000-0000-0000000000f8', 202609, date '2026-09-30',
   'ตีราคาสัญญาซื้อขายเงินตราล่วงหน้า — FXF-FXF28 (2026-09-30)', 50000, 50000,
   'Posted', 'seed', now(), false,
   'ขาดทุนจากการตีราคา 50000.00 บาท · จำนวนเงิน 100000 × (อัตราสิ้นงวด 34.5 − อัตราตามสัญญา 35.0)');
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e270-0000-0000-0000-0000000000fb', 1, '5439907', 'ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา', 50000, 0, 'ขาดทุนจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง — FXF-FXF28'),
  ('d9d9e270-0000-0000-0000-0000000000fb', 2, '2391101', 'หนี้สินตราสารอนุพันธ์ - Current portion',    0, 50000, 'ตีราคาสัญญา FXF-FXF28 ณ อัตรา 34.5');

-- (วันที่ 2026-09-30 → ใบสำคัญตกอยู่ในช่วง default ของหน้า Journal Entries ค้นเจอได้เลย)

-- ⑥ ใบกลับรายการต้นเดือนถัดไป (2026-10-01, Posted)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, description, total_dr, total_cr,
   status, posted_by, posted_at, is_reversal, remark)
values
  ('d9d9e270-0000-0000-0000-0000000000fc', next_je_number(), 'FX_VALUATION',
   'd9d9e270-0000-0000-0000-0000000000f8', 202609, date '2026-10-01',
   'กลับรายการตีราคา — FXF-FXF28 (ของงวด 2026-09-30)', 50000, 50000,
   'Posted', 'seed', now(), true, 'กลับรายการใบสำคัญตีราคา FXF-FXF28');
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e270-0000-0000-0000-0000000000fc', 1, '2391101', 'หนี้สินตราสารอนุพันธ์ - Current portion',    50000, 0, 'กลับรายการ: ตีราคาสัญญา FXF-FXF28 ณ อัตรา 34.5'),
  ('d9d9e270-0000-0000-0000-0000000000fc', 2, '5439907', 'ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา', 0, 50000, 'กลับรายการ: ขาดทุนจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง — FXF-FXF28');

-- ผูกใบต้นเรื่อง ↔ ใบกลับรายการ + อัปเดตแถวตีราคา
update journal_entries set reversed_by_je_id = 'd9d9e270-0000-0000-0000-0000000000fc'
  where id = 'd9d9e270-0000-0000-0000-0000000000fb';
update fx_valuations set je_id = 'd9d9e270-0000-0000-0000-0000000000fb', status = 'Posted',
  remark = 'ใบสำคัญตีราคา (seed) · กลับรายการ 2026-10-01'
  where id = 'd9d9e270-0000-0000-0000-0000000000fa';

-- ⑦ ตรวจผล: รหัสบัญชีในใบสำคัญ มีอยู่ในผังบัญชีไหม (+ บริษัท)
select l.account_code, l.account_name,
       g.company as coa_company,
       case when g.code is null then '❌ ไม่พบในผังบัญชี' else '✅ พบ' end as in_coa
  from je_lines l
  left join gl_accounts g on g.code = l.account_code
 where l.je_id = 'd9d9e270-0000-0000-0000-0000000000fb'
 order by l.line_no;
-- คาดหวัง: 5439907 → All ✅ · 2391101 → XMT ✅ (พบ แต่ไม่ใช่ MGC/All — ดู ⚠️ ด้านบน)
