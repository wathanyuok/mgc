-- ============================================================
-- Seed: FX-53 / FR-FXF-003 · FR-FXF-009 / UC-FXF-004 — กำไร/ขาดทุนที่เกิดขึ้นจริงตอนปิดสัญญา
--
--   สัญญา 2 ใบ (ซื้อทั้งคู่ · forward 35.00 · Active · default GL) ไว้ปิดแล้วดูบรรทัดกำไร/ขาดทุน
--     FXF-FXF53G → ปิดที่อัตราตลาด 35.50 (สูงกว่าสัญญา) → กำไร +50,000 · Cr 4929103
--     FXF-FXF53L → ปิดที่อัตราตลาด 34.50 (ต่ำกว่าสัญญา) → ขาดทุน -50,000 · Dr 5439907
--
--   สูตร (approveSettlement): realized = notional × (อัตราตลาด − อัตราสุทธิตามสัญญา)   [ซื้อ]
--     อัตราสุทธิตามสัญญา = forward + swap discount (seed นี้ไม่มีส่วนลด → = 35.00)
--
--   value_date = 2026-09-30 → ใบสำคัญปิดสัญญาลงวันที่นี้ ตกในช่วง default ของหน้า
--   Journal Entries (90 วันล่าสุดถึงวันนี้) ค้นเจอได้เลยไม่ต้องขยายวันที่
--
-- วิธีทดสอบ FX-53:
--   1. เปิด FXF-FXF53G → "💱 ขอปิดสัญญา" → อัตราตลาด ณ วันปิดสัญญา = 35.50 → ยืนยัน → อนุมัติปิดสัญญา
--   2. เปิด FXF-FXF53L → "💱 ขอปิดสัญญา" → อัตราตลาด ณ วันปิดสัญญา = 34.50 → ยืนยัน → อนุมัติปิดสัญญา
--   3. เมนู GL / NetSuite Sync → Journal Entries → ค้นเลขสัญญา → เปิดใบ "— ปิดสัญญาฯ"
--   ผล: G มีบรรทัด Cr 4929103 กำไร 50,000 · L มีบรรทัด Dr 5439907 ขาดทุน 50,000
--       (เทียบอัตราสุทธิตามสัญญา 35.00 กับอัตราตลาด ณ วันปิด)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id in ('d9d9e270-0000-0000-0000-000000000113','d9d9e270-0000-0000-0000-000000000114');
delete from fx_valuations where fxf_id in ('d9d9e270-0000-0000-0000-000000000113','d9d9e270-0000-0000-0000-000000000114');
delete from fx_forwards where id in ('d9d9e270-0000-0000-0000-000000000113','d9d9e270-0000-0000-0000-000000000114')
   or fxf_no in ('FXF-FXF53G','FXF-FXF53L');
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000112' or contract_number = 'CA-FXF53-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000111';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000111' or ma_name = 'MA-FXF53-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000111','BBL','MA-FXF53-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000111','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards = [] → ใบสำคัญตก default)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000112','d9d9e270-0000-0000-0000-000000000111',
   'CA-FXF53-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF53-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb, '[]'::jsonb);

-- ③ FXF ใบกำไร (ปิดที่ 35.50)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000113','FXF-FXF53G','FXF-FXF53G (ซื้อ — ปิดที่ 35.50 → กำไร 50,000)',
   'd9d9e270-0000-0000-0000-000000000112','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-53 กำไร · ปิดที่อัตราตลาด 35.50 → realized +50,000 · Cr 4929103', now(), now());

-- ④ FXF ใบขาดทุน (ปิดที่ 34.50)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000114','FXF-FXF53L','FXF-FXF53L (ซื้อ — ปิดที่ 34.50 → ขาดทุน 50,000)',
   'd9d9e270-0000-0000-0000-000000000112','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-53 ขาดทุน · ปิดที่อัตราตลาด 34.50 → realized -50,000 · Dr 5439907', now(), now());

-- ⑤ ตรวจผล: จำลอง realized P/L ที่อัตราปิดของแต่ละใบ (ซื้อ: ตลาด − สัญญา)
select
  fxf_no, direction, forward_rate as contract_rate,
  case when fxf_no = 'FXF-FXF53G' then 35.50 else 34.50 end as close_rate,
  round(notional_amount_foreign *
        ((case when fxf_no = 'FXF-FXF53G' then 35.50 else 34.50 end) - forward_rate), 2) as realized_thb,
  case when round(notional_amount_foreign *
        ((case when fxf_no = 'FXF-FXF53G' then 35.50 else 34.50 end) - forward_rate), 2) > 0
       then 'กำไร → Cr 4929103' else 'ขาดทุน → Dr 5439907' end as pnl_line
  from fx_forwards
 where id in ('d9d9e270-0000-0000-0000-000000000113','d9d9e270-0000-0000-0000-000000000114')
 order by fxf_no;
-- คาดหวัง: G → +50000.00 กำไร · L → -50000.00 ขาดทุน
