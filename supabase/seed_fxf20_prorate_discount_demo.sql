-- ============================================================
-- Seed: FX-20 / FR-FXF-009 — ส่วนลดแบบปันส่วนตามวันใช้จริง (อิงวันสัญญา ไม่ใช่วันกดปุ่ม)
--
--   • MA-FXF20 / CA-FXF20 (FXF · Approved) + FXF-FXF20 (Active) ตั้งส่วนลดแบบ "ปันส่วน"
--
--   พารามิเตอร์ของสัญญา (ใช้คำนวณส่วนลดปันส่วน):
--     deal_date      = 2026-07-01   (วันทำสัญญา)
--     maturity_date  = 2026-08-30   (วันครบกำหนด)       → fullDays = 60
--     value_date     = 2026-07-31   (วันส่งมอบ/ปิดจริง) → usedDays = 30
--     forward_rate   = 35.000000
--     swap_discount  = -0.300000 · discount_mode = 'pro_rate'
--     notional       = 100,000 USD
--
--   สูตรปันส่วน (โค้ด approveSettlement):
--     d = swap_discount × (usedDays / fullDays) = -0.30 × 30/60 = -0.150000
--     effectiveRate = forward_rate + d = 35.000000 - 0.150000 = 34.850000
--     amountContract = notional × effectiveRate = 100,000 × 34.85 = 3,485,000.00
--
--   *** จำนวนวันนับจาก deal_date → value_date/maturity (วันตามสัญญา) ไม่ใช่ "วันนี้" ***
--       จึงกดปิดสัญญาวันไหนก็ได้ยอดเท่าเดิมเสมอ (deterministic)
--
-- วิธีทดสอบ FX-20:
--   1. เปิด FXF-FXF20 → ขอปิดสัญญา (ใส่อัตราตลาด ณ วันปิด) → อนุมัติปิดสัญญา
--   2. จดยอด "ส่วนลดปันส่วน" ที่ขึ้น (ควร = 30/60 วัน = -0.1500 · amountContract 3,485,000.00)
--   3. (จำลองวันถัดไป) กลับรายการใบปิด แล้วปิดใหม่ หรือดูสัญญาใบแฝดที่ตั้งเหมือนกัน
--   ผล: ยอดส่วนลด/ยอดบาทตามสัญญา "เท่าเดิม" ไม่ขึ้นกับวันที่กดปุ่ม
--       (อ้างอิง deal_date/value_date/maturity เท่านั้น)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-0000000000e5';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000e5' or fxf_no = 'FXF-FXF20';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e3' or contract_number = 'CA-FXF20-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000e4';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e4' or ma_name = 'MA-FXF20-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000e4','BBL','MA-FXF20-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000e4','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards ครบ)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000e3','d9d9e270-0000-0000-0000-0000000000e4',
   'CA-FXF20-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF20-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"OTHER ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb);

-- ③ FXF (Active) — ตั้งส่วนลดปันส่วน · value_date ก่อนครบกำหนด (ใช้จริง 30/60 วัน)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000e5','FXF-FXF20','FXF-FXF20 (ส่วนลดปันส่วน)',
   'd9d9e270-0000-0000-0000-0000000000e3','BBL',
   date '2026-07-01', date '2026-07-01', date '2026-08-30', date '2026-07-31',
   60, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.800000, 35.000000, 0.200000, -0.300000, 'pro_rate',
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"OTHER ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'Active', 'seed FX-20 · ส่วนลดปันส่วน 30/60 วัน → d=-0.15 · effRate 34.85 · amountContract 3,485,000', now(), now());

-- ④ ตรวจผล: คำนวณส่วนลดปันส่วนที่ควรได้ (อ้างวันสัญญา ไม่ใช่วันนี้)
select
  fxf_no, deal_date, value_date, maturity_date, forward_rate, swap_discount,
  (date_part('day', maturity_date::timestamp - deal_date::timestamp))::int as full_days,
  (date_part('day', value_date::timestamp - deal_date::timestamp))::int    as used_days,
  round(swap_discount * (date_part('day', value_date::timestamp - deal_date::timestamp)
        / date_part('day', maturity_date::timestamp - deal_date::timestamp))::numeric, 4) as prorated_discount,
  round((forward_rate + swap_discount * (date_part('day', value_date::timestamp - deal_date::timestamp)
        / date_part('day', maturity_date::timestamp - deal_date::timestamp))::numeric), 6) as effective_rate,
  round(notional_amount_foreign * (forward_rate + swap_discount * (date_part('day', value_date::timestamp - deal_date::timestamp)
        / date_part('day', maturity_date::timestamp - deal_date::timestamp))::numeric), 2) as amount_contract
  from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000e5';
-- คาดหวัง: full_days=60 · used_days=30 · prorated_discount=-0.1500 · effective_rate=34.850000 · amount_contract=3,485,000.00
