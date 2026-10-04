-- ============================================================
-- Seed: FX-73 / FR-FXF-003 — กรองใบสำคัญของโมดูล FX Forward เจอครบทุกประเภท
--
--   แนวทาง: สร้าง 3 สัญญา Active (แยกใบตามจริง) ไว้ให้ผู้ทดสอบ "กดสร้างใบสำคัญผ่าน UI จริง"
--   ไม่ยัดใบสำคัญปลอมลงฐานข้อมูล — ใบสำคัญทุกใบเกิดจากการทำงานจริงของระบบในปัจจุบัน
--
--     FXF-FXF73A (Active) → ไว้กด "ลงบัญชีค่าธรรมเนียม" (แท็บ Fee Payment)  → ได้ใบ FXF_FEE
--     FXF-FXF73B (Active) → ไว้กด "ลงบัญชีมูลค่ายุติธรรม" (แท็บ Fair Value) → ได้ใบ FX_VALUATION (+ ใบกลับรายการ)
--     FXF-FXF73C (Active) → ไว้ "ขอปิดสัญญา → อนุมัติปิดสัญญา"              → ได้ใบ FXF_SETTLEMENT
--
--   value_date = 2026-09-30 → ใบที่ลงวันตาม value_date/งวด ตกในช่วง default ของหน้า Journal Entries
--
-- วิธีทดสอบ FX-73 (อ้างอิง seed นี้):
--   1. FXF-FXF73A → แท็บ Fee Payment → กรอกค่าธรรมเนียม → "ลงบัญชีค่าธรรมเนียม"
--   2. FXF-FXF73B → แท็บ Fair Value → ACCOUNTING PERIOD = 2026-09-30 · กรอก SPOT RATE (เช่น 34.50)
--                   → "ลงบัญชีมูลค่ายุติธรรม"
--   3. FXF-FXF73C → "ขอปิดสัญญา" (อัตราตลาด เช่น 35.50) → "อนุมัติปิดสัญญา"
--   4. เมนู GL / NetSuite Sync → Journal Entries → SOURCE = "FX Forward Rate" (หรือค้น "FXF-FXF73")
--   ผล: กรองเจอใบครบ — FXF_FEE, FX_VALUATION (+ ใบกลับรายการ), FXF_SETTLEMENT · badge = "FX Forward Rate"
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id in ('d9d9e270-0000-0000-0000-00000000073a','d9d9e270-0000-0000-0000-00000000073b','d9d9e270-0000-0000-0000-00000000073c');
delete from fx_valuations where fxf_id in ('d9d9e270-0000-0000-0000-00000000073a','d9d9e270-0000-0000-0000-00000000073b','d9d9e270-0000-0000-0000-00000000073c');
delete from fxf_fees where fxf_id in ('d9d9e270-0000-0000-0000-00000000073a','d9d9e270-0000-0000-0000-00000000073b','d9d9e270-0000-0000-0000-00000000073c');
delete from fx_forwards where id in ('d9d9e270-0000-0000-0000-00000000073a','d9d9e270-0000-0000-0000-00000000073b','d9d9e270-0000-0000-0000-00000000073c')
   or fxf_no in ('FXF-FXF73A','FXF-FXF73B','FXF-FXF73C');
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000732' or contract_number = 'CA-FXF73-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000731';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000731' or ma_name = 'MA-FXF73-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000731','BBL','MA-FXF73-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 60000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000731','MGC',60000000,0,0);

-- ② CA (FXF)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000732','d9d9e270-0000-0000-0000-000000000731',
   'CA-FXF73-DEMO (วงเงิน FX Forward)', 'CA-FXF73-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   60000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ สัญญา Active 3 ใบ (ตั้งค่าเหมือนกัน · ต่างกันแค่ไว้ทดสอบคนละเหตุการณ์)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-00000000073a','FXF-FXF73A','FXF-FXF73A (ไว้ลงค่าธรรมเนียม)',
   'd9d9e270-0000-0000-0000-000000000732','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb, 'Active', 'seed FX-73 · ไว้กดลงบัญชีค่าธรรมเนียม → FXF_FEE', now(), now()),
  ('d9d9e270-0000-0000-0000-00000000073b','FXF-FXF73B','FXF-FXF73B (ไว้ตีราคา)',
   'd9d9e270-0000-0000-0000-000000000732','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-12-31', date '2026-12-31',
   183, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb, 'Active', 'seed FX-73 · ไว้กดลงบัญชีมูลค่ายุติธรรม (งวด 2026-09-30) → FX_VALUATION', now(), now()),
  ('d9d9e270-0000-0000-0000-00000000073c','FXF-FXF73C','FXF-FXF73C (ไว้ปิดสัญญา)',
   'd9d9e270-0000-0000-0000-000000000732','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-09-30', date '2026-09-30',
   91, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb, 'Active', 'seed FX-73 · ไว้ขอปิดสัญญา → อนุมัติ → FXF_SETTLEMENT', now(), now());

-- ④ ตรวจผล: 3 สัญญา Active พร้อมให้กดสร้างใบสำคัญผ่าน UI
select fxf_no, status, value_date, notional_amount_foreign, forward_rate,
       'กดสร้างใบผ่านหน้าสัญญาตามข้อ 1-3' as how_to
  from fx_forwards
 where ca_id = 'd9d9e270-0000-0000-0000-000000000732'
 order by fxf_no;
-- คาดหวัง: FXF-FXF73A/B/C ทั้งหมด Active
