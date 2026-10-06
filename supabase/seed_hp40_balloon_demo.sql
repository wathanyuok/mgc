-- ============================================================
-- Seed: HP-40 — สัญญาเช่าซื้อที่มีเงินก้อนท้าย (Balloon) → แถวก้อนท้ายพื้นสีส้ม + ตัวหนา
--
--   HP-DEMO-040 (mode=hp) · เงินต้น 1,000,000 · 5% · 48 งวด · BALLOON 200,000 (พร้อมงวดสุดท้าย)
--   ไว้เปิดแท็บ Amortization Schedule ดูแถวงวดสุดท้ายที่รวมเงินก้อนท้าย (ไฮไลต์ bg-amber-50 font-bold)
--
-- วิธีทดสอบ HP-40 (อ้างอิง seed นี้):
--   1. เปิด HP-DEMO-040 → แท็บ Amortization Schedule
--   2. เลื่อนไปแถวงวดสุดท้าย (รวม Balloon 200,000)
--   ผล: แถวเงินก้อนท้ายมีพื้นสีส้ม + ตัวหนา · แถวงวดปกติไม่ไฮไลต์
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000004001' or lease_no = 'HP-DEMO-040';
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000040c1' or contract_number = 'CA-HP40-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000040a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000040a1' or ma_name = 'MA-HP40-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000040a1','BBL','MA-HP40-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000040a1','MGC',30000000,0,0);

-- ② CA (HP)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000040c1','d9d9ea50-0000-0000-0000-0000000040a1',
   'CA-HP40-DEMO (วงเงินเช่าซื้อ HP)', 'CA-HP40-DEMO', 'MGC',
   (select id from facility_types where code='HP' limit 1),
   30000000, 'THB', 'Term', 'BBL',
   date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ Lease HP (Draft) · BALLOON 200,000 พร้อมงวดสุดท้าย
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000004001','HP-DEMO-040','d9d9ea50-0000-0000-0000-0000000040c1','MGC','hp',
   false,'HP40-CONTRACT-001', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2030-09-29','Fix Installment (Balloon) / Fix Installment & Step payment (Balloon)','รถยนต์','รถกระบะ Toyota Hilux Revo',
   'MR0FR22G400000040','BBL',1200000,200000,1000000,1000000,
   5,48, date '2026-09-01',200000,'with-last',0,
   0,0,0,5,48,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Draft','seed HP-40 · เช่าซื้อ 1,000,000 · 5% · 48 งวด · BALLOON 200,000 พร้อมงวดสุดท้าย','BANKREF-HP40-001', now(), now());

-- ④ ตรวจผล
select lease_no, mode, status, principal, term_months, balloon_amount, balloon_pattern, include_balloon_installment
  from leases where id = 'd9d9ea50-0000-0000-0000-000000004001';
-- คาดหวัง: HP-DEMO-040 · balloon_amount=200000 · with-last · include=true → แถวงวดท้ายไฮไลต์สีส้ม+ตัวหนา
