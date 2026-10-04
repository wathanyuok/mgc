-- ============================================================
-- Seed: FX-72 / FR-FXF-001 — ยอดสัญญา FX Forward ตรงกับที่กรอกในรายงาน
--
--   FXF-FXF72 (Active) · notional 100,000 USD × forward 35.00 = amount_thb 3,500,000
--   ผูกวงเงิน CA-FXF72-DEMO (credit_line 20,000,000) เพื่อตรวจยอดในรายงาน
--
--   รายงานที่เปิดใช้ในเมนู (ยอด FXF อ้าง amount_thb):
--     • Credit Transaction Report (std_tx) → แถว FX Forward แสดง 3,500,000
--     • Credit Agreement Report (std_ca)   → Utilization ของ CA รวม 3,500,000
--     • Dashboard                          → ภาพรวมพอร์ต ยอด FX Forward
--
-- วิธีทดสอบ FX-72 (อ้างอิง seed นี้):
--   1. REPORTS → "Credit Transaction" → หาแถว FT = FX Forward · เลขที่ FXF-FXF72 → ยอด = 3,500,000.00
--   2. REPORTS → "Credit Agreement" → หา CA-FXF72-DEMO → Utilization รวม 3,500,000
--   3. Dashboard → ภาพรวมพอร์ต → ยอด FX Forward รวมรายการนี้
--   ผล: ทุกที่แสดง 3,500,000 ตรงกับ notional × forward ที่กรอก (ไม่ใช่ 0.00)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-000000000153';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-000000000153' or fxf_no = 'FXF-FXF72';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000152' or contract_number = 'CA-FXF72-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000151';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000151' or ma_name = 'MA-FXF72-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000151','BBL','MA-FXF72-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000151','MGC',20000000,0,0);

-- ② CA (FXF · credit_line 20M)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000152','d9d9e270-0000-0000-0000-000000000151',
   'CA-FXF72-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF72-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ FXF (Active · amount_thb 3,500,000 = 100,000 × 35.00)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000153','FXF-FXF72','FXF-FXF72 (ยอด 3,500,000 ตรวจในรายงาน)',
   'd9d9e270-0000-0000-0000-000000000152','BBL',
   date '2026-08-01', date '2026-08-01', date '2026-12-31', date '2026-12-31',
   152, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-72 · amount_thb 3,500,000 = 100,000 × 35.00 ไว้ตรวจยอดในรายงาน', now(), now());

-- ④ ตรวจผล: ยอดที่รายงานจะดึง (amount_thb) + ยอดใช้วงเงินของ CA
select f.fxf_no, f.status, f.notional_amount_foreign, f.forward_rate, f.amount_thb,
       (f.notional_amount_foreign * f.forward_rate) as calc_check,
       c.contract_number, c.credit_line, c.utilization
  from fx_forwards f
  join credit_agreements c on c.id = f.ca_id
 where f.id = 'd9d9e270-0000-0000-0000-000000000153';
-- คาดหวัง: amount_thb = 3,500,000 = calc_check · CA utilization รวมยอดนี้ (trigger recalc_ca_utilization)
