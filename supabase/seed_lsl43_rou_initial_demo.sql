-- ============================================================
-- Seed: LSL-43 — สิทธิการใช้สินทรัพย์ตั้งต้น (ROU) + หนี้สิน
--
--   LEASE-DEMO-43 (mode=lease · Active)
--     PRINCIPAL AMOUNT (จำนวนเงิน) = 800,000
--     UPFRONT PAYMENT (เงินจ่ายวันแรก) = 50,000
--     PREPAID (เงินจ่ายล่วงหน้า) = 30,000
--   คาดหวัง:
--     ROU Asset (ตั้งต้น) = 800,000 (= PRINCIPAL · รวม upfront + prepaid แล้ว)
--     Lease Liability     = 800,000 − 50,000 − 30,000 = 720,000
--
-- วิธีทดสอบ LSL-43:
--   เปิด LEASE-DEMO-43 → ดูการ์ดสรุป ROU Asset (ตั้งต้น) และหนี้สินตามสัญญาเช่า
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005043' or lease_no = 'LEASE-DEMO-43';
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000543c1' or contract_number = 'CA-LSL43-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000543a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000543a1' or ma_name = 'MA-LSL43-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000543a1','BBL','MA-LSL43-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000543a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000543c1','d9d9ea50-0000-0000-0000-0000000543a1',
   'CA-LSL43-DEMO (วงเงินสัญญาเช่า)', 'CA-LSL43-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ Lease Leasing (Active · upfront 50,000 · prepaid 30,000)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005043','LEASE-DEMO-43','d9d9ea50-0000-0000-0000-0000000543c1','MGC','lease',
   false,'LSL43-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',50000,
   0,1,30000,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Active','seed LSL-43 · principal 800k · upfront 50k · prepaid 30k → ROU 800k · หนี้สิน 720k','BANKREF-LSL43', now(), now());

-- ④ ตรวจผล
select lease_no, principal, upfront_payment, prepaid_amount,
       principal as rou_asset,
       (principal - coalesce(upfront_payment,0) - coalesce(prepaid_amount,0)) as lease_liability
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005043';
-- คาดหวัง: rou_asset = 800,000 · lease_liability = 720,000
