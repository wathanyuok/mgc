-- ============================================================
-- Seed: LSL-32 — ชำระสิ้นเดือน (PAY AT END OF MONTHS)
--
--   สัญญา Leasing คู่ ตั้งค่าเหมือนกัน · PAYMENT START DATE = 15/09/2026 · ต่างแค่ pay_eom:
--     LEASE-DEMO-32A = PAY AT END OF MONTHS ติ๊ก (pay_eom=true)  → วันครบกำหนด = สิ้นเดือน (30/09, 31/10, ...)
--     LEASE-DEMO-32B = ไม่ติ๊ก (pay_eom=false)                   → วันครบกำหนด = วันที่ 15 ทุกเดือน (วันเดียวกับวันเริ่ม)
--
-- วิธีทดสอบ LSL-32 (อ้างอิง seed นี้):
--   เปิด 32A และ 32B → แท็บ Amortization Schedule → เทียบคอลัมน์ PAYMENT DATE
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id in ('d9d9ea50-0000-0000-0000-00000000532a','d9d9ea50-0000-0000-0000-00000000532b')
   or lease_no in ('LEASE-DEMO-32A','LEASE-DEMO-32B');
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000532c1' or contract_number = 'CA-LSL32-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000532a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000532a1' or ma_name = 'MA-LSL32-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000532a1','BBL','MA-LSL32-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000532a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000532c1','d9d9ea50-0000-0000-0000-0000000532a1',
   'CA-LSL32-DEMO (วงเงินสัญญาเช่า)', 'CA-LSL32-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- acct_cards net ใช้ร่วม (ใส่ซ้ำสองสัญญา)
-- ③ 32A — PAY AT END OF MONTHS = true (สิ้นเดือน)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000532a','LEASE-DEMO-32A','d9d9ea50-0000-0000-0000-0000000532c1','MGC','lease',
   false,'LSL32A-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-15', date '2029-09-14','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter (สิ้นเดือน)',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-32A · PAY AT END OF MONTHS = true → วันครบกำหนดสิ้นเดือน','BANKREF-LSL32A', now(), now());

-- ④ 32B — PAY AT END OF MONTHS = false (วันเดียวกับวันเริ่ม = วันที่ 15)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000532b','LEASE-DEMO-32B','d9d9ea50-0000-0000-0000-0000000532c1','MGC','lease',
   false,'LSL32B-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-15', date '2029-09-14','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter (วันที่ 15)',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,false, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-32B · PAY AT END OF MONTHS = false → วันครบกำหนด = วันที่ 15 ทุกเดือน','BANKREF-LSL32B', now(), now());

-- ⑤ ตรวจผล
select lease_no, pay_eom, payment_start_date
  from leases where id in ('d9d9ea50-0000-0000-0000-00000000532a','d9d9ea50-0000-0000-0000-00000000532b')
  order by lease_no;
-- คาดหวัง: 32A pay_eom=true (สิ้นเดือน) · 32B pay_eom=false (วันที่ 15)
