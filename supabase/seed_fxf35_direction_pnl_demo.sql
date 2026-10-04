-- ============================================================
-- Seed: FX-35 / FR-FXF-001 · FR-FXF-002 / UC-FXF-003 — ทิศทางสัญญามีผลต่อกำไร/ขาดทุน
--
--   สัญญาคู่ ตั้งค่าเหมือนกันทุกอย่าง ต่างแค่ทิศทาง (ซื้อ vs ขาย) ไว้เทียบข้างกัน
--     FXF-FXF35B = ซื้อ (Buy)   · FXF-FXF35S = ขาย (Sell)
--     notional = 100,000 USD · forward_rate = 35.000000 · Active · acct_cards = [] (default)
--
--   สูตร (computeMTM): mtm = notional × (EOM − forward) · ถ้า Sell → กลับเครื่องหมาย
--
--   กรณีทดสอบ EOM = 35.50 (สูงกว่า forward):
--     ซื้อ (Buy)  → 100,000 × (35.50 − 35.00) = +50,000.00  → กำไร
--                   ใบสำคัญ: Dr 1191999 / Cr 4929103
--     ขาย (Sell) → −[100,000 × (35.50 − 35.00)] = -50,000.00 → ขาดทุน
--                   ใบสำคัญ: Dr 5439907 / Cr 2391101
--
-- วิธีทดสอบ FX-35:
--   1. เปิด FXF-FXF35B (ซื้อ) → แท็บ Fair Value → กรอก spot EOM = 35.50 → ดู Unrealized (ควร +50,000)
--   2. เปิด FXF-FXF35S (ขาย) → แท็บ Fair Value → กรอก spot EOM = 35.50 → ดู Unrealized (ควร -50,000)
--   ผล: อัตราเดียวกัน — ซื้อได้กำไร · ขายได้ขาดทุน (ขนาดเท่ากัน)
--
--   *** value_date = 2026-09-30 → ใบสำคัญปิดสัญญาลงวันที่นี้ ตกอยู่ในช่วง default
--       ของหน้า Journal Entries (90 วันล่าสุดถึงวันนี้) ค้นเจอได้เลยไม่ต้องขยายวันที่ ***
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id in ('d9d9e270-0000-0000-0000-000000000103','d9d9e270-0000-0000-0000-000000000104');
delete from fx_valuations where fxf_id in ('d9d9e270-0000-0000-0000-000000000103','d9d9e270-0000-0000-0000-000000000104');
delete from fx_forwards where id in ('d9d9e270-0000-0000-0000-000000000103','d9d9e270-0000-0000-0000-000000000104')
   or fxf_no in ('FXF-FXF35B','FXF-FXF35S');
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000102' or contract_number = 'CA-FXF35-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000101';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000101' or ma_name = 'MA-FXF35-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000101','BBL','MA-FXF35-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000101','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards = [] → ใบสำคัญตก default)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000102','d9d9e270-0000-0000-0000-000000000101',
   'CA-FXF35-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF35-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb, '[]'::jsonb);

-- ③ FXF ฝั่งซื้อ (Buy)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000103','FXF-FXF35B','FXF-FXF35B (ซื้อ — ควรได้กำไรเมื่อ EOM>forward)',
   'd9d9e270-0000-0000-0000-000000000102','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-35 ฝั่งซื้อ · EOM 35.50 → +50,000 (กำไร)', now(), now());

-- ④ FXF ฝั่งขาย (Sell) — ตั้งค่าเหมือนฝั่งซื้อทุกอย่าง ต่างแค่ direction
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000104','FXF-FXF35S','FXF-FXF35S (ขาย — ควรได้ขาดทุนเมื่อ EOM>forward)',
   'd9d9e270-0000-0000-0000-000000000102','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Sell', 'THB', 'USD', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-35 ฝั่งขาย · EOM 35.50 → -50,000 (ขาดทุน)', now(), now());

-- ⑤ ตรวจผล: จำลองการตีราคาที่ EOM = 35.50 ให้เห็นผลต่างของสองทิศทาง
select
  fxf_no, direction, notional_amount_foreign, forward_rate,
  35.50 as eom_rate,
  round(notional_amount_foreign * (35.50 - forward_rate)
        * case when direction = 'Sell' then -1 else 1 end, 2) as unrealized_thb,
  case when round(notional_amount_foreign * (35.50 - forward_rate)
        * case when direction = 'Sell' then -1 else 1 end, 2) > 0
       then 'กำไร' else 'ขาดทุน' end as result
  from fx_forwards
 where id in ('d9d9e270-0000-0000-0000-000000000103','d9d9e270-0000-0000-0000-000000000104')
 order by direction desc;
-- คาดหวัง: Buy → +50000.00 กำไร · Sell → -50000.00 ขาดทุน (อัตราเดียวกัน)
