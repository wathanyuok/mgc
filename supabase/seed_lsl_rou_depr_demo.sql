-- ============================================================
-- Seed: LSL (Leasing) — ค่าเสื่อม ROU ของสัญญาเช่า: คอลัมน์มีตัวเลข + มีปุ่มลงบัญชี
--
--   LEASE-DEMO-018 (mode=lease · Active) · เช่าการเงิน 800,000 · 4% · 36 งวด · acct_cards ชุด net/ROU (7)
--   ต่างจาก HP: Leasing ลงค่าเสื่อม ROU ในระบบ (มีปุ่ม) ไม่ใช่ NetSuite
--
-- วิธีทดสอบ (อ้างอิง seed นี้):
--   1. เปิด LEASE-DEMO-018 → แท็บ Amortization Schedule
--   2. ดูคอลัมน์ Depreciation / ROU Balance (มีตัวเลข)
--   3. ดูปุ่มในแต่ละงวด — มีปุ่มลงบัญชี (กดแล้วลงทั้งค่างวด + ค่าเสื่อม)
--   ผล: คอลัมน์ค่าเสื่อมมีตัวเลข → มีปุ่มลงบัญชีสอดคล้องกัน
--      (ถ้ายังไม่ลงบัญชีวันแรก ปุ่มจะขึ้น tooltip "ต้องลงบัญชีวันแรกก่อน" แต่ปุ่มมีอยู่)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005018' or lease_no = 'LEASE-DEMO-018';
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000050c1' or contract_number = 'CA-LSL18-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000050a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000050a1' or ma_name = 'MA-LSL18-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000050a1','BBL','MA-LSL18-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000050a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000050c1','d9d9ea50-0000-0000-0000-0000000050a1',
   'CA-LSL18-DEMO (วงเงินสัญญาเช่า Leasing)', 'CA-LSL18-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL',
   date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ Lease Leasing (mode=lease · Active · net/ROU 7 บัญชี)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005018','LEASE-DEMO-018','d9d9ea50-0000-0000-0000-0000000050c1','MGC','lease',
   false,'LSL18-CONTRACT-001', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[
     {"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ใช้ชั่วคราว — Re-measure Gain/(Loss))"}
   ]'::jsonb,
   null,'Active','seed Leasing LSL-18 · เช่าการเงิน 800,000 · 4% · 36 งวด (net/ROU) · Active ไว้ดูคอลัมน์ค่าเสื่อม+ปุ่ม','BANKREF-LSL18-001', now(), now());

-- ④ ตรวจผล
select lease_no, mode, status, principal, annual_rate, term_months, rou_useful_life
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005018';
-- คาดหวัง: LEASE-DEMO-018 · lease · Active → แท็บ Amortization Schedule มีคอลัมน์ Depreciation/ROU Balance + ปุ่มลงบัญชี
