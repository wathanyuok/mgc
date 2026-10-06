-- ============================================================
-- Seed: LSL-33 — EFFECTIVE INTEREST RATE / YEAR (คิดย้อนจากกระแสเงินสด = EIR)
--
--   สองสัญญาให้เห็นว่า EIR = จากกระแสเงินสดจริง (ไม่ใช่แค่อัตราตามสัญญา):
--     LEASE-DEMO-33A = 800,000 · 4% · 36 งวด · ไม่มี balloon/upfront → EIR ≈ อัตราตามสัญญา (4%)
--     LEASE-DEMO-33B = เหมือนกัน แต่ balloon 200,000 → กระแสเงินสดเปลี่ยน → EIR ต่างจากอัตราตามสัญญา
--
-- วิธีทดสอบ LSL-33:
--   เปิดแต่ละสัญญา → ดูช่อง EFFECTIVE INTEREST RATE / YEAR (%) + ข้อความใต้ช่อง "อัตราตามสัญญา X%"
--   33A: EIR ≈ 4% · 33B: EIR ต่างจาก 4% (เพราะมี balloon)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id in ('d9d9ea50-0000-0000-0000-00000000533a','d9d9ea50-0000-0000-0000-00000000533b')
   or lease_no in ('LEASE-DEMO-33A','LEASE-DEMO-33B');
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000533c1' or contract_number = 'CA-LSL33-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000533a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000533a1' or ma_name = 'MA-LSL33-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000533a1','BBL','MA-LSL33-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000533a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000533c1','d9d9ea50-0000-0000-0000-0000000533a1',
   'CA-LSL33-DEMO (วงเงินสัญญาเช่า)', 'CA-LSL33-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ 33A — ไม่มี balloon → EIR ≈ 4%
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000533a','LEASE-DEMO-33A','d9d9ea50-0000-0000-0000-0000000533c1','MGC','lease',
   false,'LSL33A-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter (ไม่มี balloon)',
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
   null,'Draft','seed LSL-33A · ไม่มี balloon → EIR ≈ 4%','BANKREF-LSL33A', now(), now());

-- ④ 33B — balloon 200,000 → EIR ต่างจาก 4%
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000533b','LEASE-DEMO-33B','d9d9ea50-0000-0000-0000-0000000533c1','MGC','lease',
   false,'LSL33B-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter (balloon 200k)',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',200000,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-33B · balloon 200,000 → EIR ต่างจาก 4%','BANKREF-LSL33B', now(), now());

-- ⑤ ตรวจผล
select lease_no, principal, annual_rate, term_months, balloon_amount
  from leases where id in ('d9d9ea50-0000-0000-0000-00000000533a','d9d9ea50-0000-0000-0000-00000000533b')
  order by lease_no;
-- คาดหวัง: 33A balloon 0 → EIR/YEAR ≈ 4% · 33B balloon 200,000 → EIR/YEAR ต่างจาก 4%
