-- ============================================================
-- Seed: FX-20 (ใบที่ 2) — FXF-FXF20B · ส่วนลดปันส่วน (Active · พร้อมปิดสัญญาใหม่)
--   ใช้เมื่อใบเดิม FXF-FXF20 ถูกปิด (Settled) ไปแล้ว อยากทดสอบปิดสัญญาอีกรอบ
--   พารามิเตอร์เหมือนเดิมทุกอย่าง → ส่วนลดปันส่วน 30/60 วัน = -0.1500 · ยอดตามสัญญา 3,485,000
--   self-contained (มี MA/CA ของตัวเอง) · FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-0000000000e8';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000e8' or fxf_no = 'FXF-FXF20B';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e6' or contract_number = 'CA-FXF20B-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000e7';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e7' or ma_name = 'MA-FXF20B-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000e7','BBL','MA-FXF20B-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000e7','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards ครบ)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000e6','d9d9e270-0000-0000-0000-0000000000e7',
   'CA-FXF20B-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF20B-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"OTHER ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb);

-- ③ FXF (Active) — ส่วนลดปันส่วน · value_date ก่อนครบกำหนด (ใช้จริง 30/60 วัน)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000e8','FXF-FXF20B','FXF-FXF20B (ส่วนลดปันส่วน)',
   'd9d9e270-0000-0000-0000-0000000000e6','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-08-30', date '2026-07-31',
   60, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.800000, 35.000000, 0.200000, -0.300000, 'pro_rate',
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"OTHER ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'Active', 'seed FX-20 (ใบ 2) · ส่วนลดปันส่วน 30/60 = -0.15 · effRate 34.85 · amountContract 3,485,000', now(), now());

-- ④ ตรวจผล
select fxf_no, status, deal_date, value_date, maturity_date, forward_rate, swap_discount, discount_mode
  from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000e8';
-- คาดหวัง: FXF-FXF20B · Active · 2026-07-01 · 2026-07-31 · 2026-08-30 · 35 · -0.30 · pro_rate
