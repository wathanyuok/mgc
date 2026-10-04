-- ============================================================
-- Seed: FX-27 / FR-FXF-003 / UC-FXF-002 — ลงบัญชีมูลค่ายุติธรรมด้วยบัญชี "ค่าตั้งต้น"
--
--   เดิมเทสเคสผูกบัญชีกำไร/ขาดทุนเป็นรหัสอื่นผ่านแท็บ Accounting แล้วตรวจว่าใบสำคัญใช้บัญชีนั้น
--   ปรับใหม่: ไม่มีแท็บ Accounting ให้ผูกแล้ว → ใบสำคัญต้องใช้บัญชี "ค่าตั้งต้นของระบบ"
--
--   วิธีให้ตก default: ไม่ผูก acct_cards (เว้นว่าง []) ทั้งที่ CA และ FXF
--   โค้ด resolveFXValuationGL() เมื่อไม่พบ card จะ fallback เป็น FX_VALUATION_GL:
--     • กำไรที่ยังไม่เกิดขึ้นจริง  → 4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา
--     • ขาดทุนที่ยังไม่เกิดขึ้นจริง → 5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา
--     • ขาสินทรัพย์ตราสารอนุพันธ์  → 1191999 สินทรัพย์หมุนเวียนอื่น-อื่น
--     • ขาหนี้สินตราสารอนุพันธ์    → 2391101 หนี้สินตราสารอนุพันธ์ - Current portion
--
--   พารามิเตอร์สัญญา (ไว้คำนวณผลต่างตอนทดสอบ):
--     notional     = 100,000 USD
--     forward_rate = 35.000000
--     status       = Active · ยังไม่ตีราคางวดใด
--
--   ตัวอย่างการคำนวณ (ผู้ทดสอบกรอก spot สิ้นงวดเอง):
--     spot EOM = 35.50 → ผลต่าง = 100,000 × (35.50 − 35.00) = +50,000 (กำไร)
--        ใบสำคัญ: Dr 1191999  50,000 / Cr 4929103  50,000
--     spot EOM = 34.50 → ผลต่าง = 100,000 × (34.50 − 35.00) = -50,000 (ขาดทุน)
--        ใบสำคัญ: Dr 5439907  50,000 / Cr 2391101  50,000
--
-- วิธีทดสอบ FX-27:
--   1. เปิด FXF-FXF27 (Active) → แท็บ Fair Value
--   2. ตั้ง ACCOUNTING PERIOD = 2026-09-30 (สิ้นงวดก่อนวันนี้) เพื่อให้ใบสำคัญตกอยู่ใน
--      ช่วง default ของหน้า Journal Entries (90 วันล่าสุดถึงวันนี้) ค้นเจอได้เลย
--      *** ถ้าใช้ค่า default ของช่อง (สิ้นเดือนปัจจุบัน) ใบจะลงวันที่อนาคต ต้องขยายช่วงวันที่เอง ***
--   3. กรอกอัตราตลาด ณ สิ้นงวด (spot EOM) ให้ผลต่าง ≠ 0 → กดลงบัญชีมูลค่ายุติธรรม
--   4. เปิดใบสำคัญดู
--   ผล: บรรทัดกำไร/ขาดทุนใช้บัญชี "ค่าตั้งต้น" (4929103 / 5439907)
--       ไม่มีบัญชีที่ผูกเอง เพราะไม่มีแท็บ Accounting แล้ว
--       + ลงใบกลับรายการวันที่ 1 เดือนถัดไปด้วยบัญชีชุดเดียวกันอัตโนมัติ
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id = 'd9d9e270-0000-0000-0000-0000000000f5';
delete from fx_valuations where fxf_id = 'd9d9e270-0000-0000-0000-0000000000f5';
delete from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000f5' or fxf_no = 'FXF-FXF27';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000f3' or contract_number = 'CA-FXF27-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000f4';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000f4' or ma_name = 'MA-FXF27-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000f4','BBL','MA-FXF27-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000f4','MGC',20000000,0,0);

-- ② CA (FXF · Approved · acct_cards = [] → ไม่ผูกบัญชี ให้ตก default)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000f3','d9d9e270-0000-0000-0000-0000000000f4',
   'CA-FXF27-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF27-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb,
   '[]'::jsonb);

-- ③ FXF (Active · ยังไม่ตีราคา · acct_cards = [] → ใบสำคัญตีราคาตก default)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f5','FXF-FXF27','FXF-FXF27 (ตีราคาด้วยบัญชี default)',
   'd9d9e270-0000-0000-0000-0000000000f3','BBL',
   date '2026-09-01', date '2026-09-01', date '2026-12-31', date '2026-12-31',
   121, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-27 · ไม่ผูก acct_cards → ตีราคาตก default 4929103/5439907 · asset 1191999 / liab 2391101', now(), now());

-- ④ ตรวจผล: ยืนยันว่า acct_cards ว่างจริง (จะตก default ตอนลงบัญชี)
select
  fxf_no, status, notional_amount_foreign, forward_rate,
  acct_cards,
  jsonb_array_length(acct_cards) as n_cards   -- คาดหวัง 0 → ตก default
  from fx_forwards where id = 'd9d9e270-0000-0000-0000-0000000000f5';
-- คาดหวัง: n_cards = 0 · ใบสำคัญตีราคาจะใช้ 4929103 (กำไร) / 5439907 (ขาดทุน) โดยอัตโนมัติ
