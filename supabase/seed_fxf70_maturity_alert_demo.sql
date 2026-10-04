-- ============================================================
-- Seed: FX-70 — แจ้งเตือนใกล้ครบกำหนด / เกินกำหนด (FX Forward)
--
--   สัญญา 2 ใบ (Active) ตั้ง maturity_date คร่อมวันนี้ (04/10/2026) · window แจ้งเตือน = 30 วัน
--     FXF-FXF70N → maturity 2026-10-08 (อีก ~4 วัน)  → ป้าย "ใกล้ครบ" · "อีก X วัน"
--     FXF-FXF70O → maturity 2026-09-28 (เกิน ~6 วัน)  → ป้าย "เกินกำหนด" · "เกินกำหนด X วัน"
--
--   เกณฑ์แจ้งเตือน (notifications.ts): สถานะไม่อยู่ใน (Settled/Closed/Cancelled)
--   และ maturity_date ≤ วันนี้ + 30 วัน
--
-- วิธีทดสอบ FX-70:
--   1. เปิดหน้าแจ้งเตือน (ไอคอนกระดิ่งมุมขวาบน) → หมวด "FX Forward ครบกำหนด"
--   ผล: FXF-FXF70N ขึ้น "ใกล้ครบ · อีก X วัน" · FXF-FXF70O ขึ้น "เกินกำหนด · เกินกำหนด X วัน"
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type in ('FXF_SETTLEMENT','FXF_FEE','FX_VALUATION','FXF_FAIRVALUE')
   and source_id in ('d9d9e270-0000-0000-0000-000000000143','d9d9e270-0000-0000-0000-000000000144');
delete from fx_forwards where id in ('d9d9e270-0000-0000-0000-000000000143','d9d9e270-0000-0000-0000-000000000144')
   or fxf_no in ('FXF-FXF70N','FXF-FXF70O');
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-000000000142' or contract_number = 'CA-FXF70-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-000000000141';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-000000000141' or ma_name = 'MA-FXF70-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-000000000141','BBL','MA-FXF70-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-000000000141','MGC',20000000,0,0);

-- ② CA (FXF)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-000000000142','d9d9e270-0000-0000-0000-000000000141',
   'CA-FXF70-DEMO (วงเงิน FX Forward)', 'CA-FXF70-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ FXF ใกล้ครบกำหนด (maturity 2026-10-08 · อีก ~4 วัน)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000143','FXF-FXF70N','FXF-FXF70N (ใกล้ครบ — อีกไม่กี่วัน)',
   'd9d9e270-0000-0000-0000-000000000142','BBL',
   date '2026-08-08', date '2026-08-08', date '2026-10-08', date '2026-10-08',
   61, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-70 · ใกล้ครบกำหนด → แจ้งเตือน "อีก X วัน"', now(), now());

-- ④ FXF เกินกำหนด (maturity 2026-09-28 · เกิน ~6 วัน) · ยังไม่ปิด
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, transaction_date, maturity_date, value_date,
   term_days, direction, ccy_buy, ccy_sell, currency, notional_amount_foreign, amount_thb,
   amount_buy, amount_sell, spot_rate, forward_rate, swap_points, swap_discount, discount_mode,
   acct_cards, status, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-000000000144','FXF-FXF70O','FXF-FXF70O (เกินกำหนด — ยังไม่ปิด)',
   'd9d9e270-0000-0000-0000-000000000142','BBL',
   date '2026-07-28', date '2026-07-28', date '2026-09-28', date '2026-09-28',
   62, 'Buy', 'USD', 'THB', 'USD', 100000, 3500000,
   100000, 3500000, 34.900000, 35.000000, 0.100000, null, null,
   '[]'::jsonb,
   'Active', 'seed FX-70 · เกินกำหนดแล้วแต่ยังไม่ปิด → แจ้งเตือน "เกินกำหนด X วัน"', now(), now());

-- ⑤ ตรวจผล: จำนวนวันถึงครบกำหนดของแต่ละใบ (เทียบวันนี้)
select fxf_no, status, maturity_date,
       (maturity_date - current_date) as days_to_maturity,
       case when maturity_date < current_date then 'เกินกำหนด'
            when maturity_date <= current_date + 30 then 'ใกล้ครบ (ภายใน 30 วัน)'
            else 'ยังไม่เข้าช่วงเตือน' end as alert_expected
  from fx_forwards
 where id in ('d9d9e270-0000-0000-0000-000000000143','d9d9e270-0000-0000-0000-000000000144')
 order by maturity_date;
-- คาดหวัง: FXF-FXF70O → เกินกำหนด · FXF-FXF70N → ใกล้ครบ
