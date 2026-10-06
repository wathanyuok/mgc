-- ============================================================
-- Seed: LSL-46 — อายุการใช้งาน (ROU USEFUL LIFE) ยาวกว่าอายุสัญญา (LEASE TERM)
--
--   LEASE-DEMO-46 (mode=lease · Active) · เงินต้น 800,000 · 4%
--     LEASE TERM = 36 เดือน · ROU USEFUL LIFE = 60 เดือน
--   คาดหวัง: ข้อความเตือนสีเหลือง · ตารางแสดงถึงงวด 36 · ค่าเสื่อมงวด 37-60 ไม่แสดงแต่ยังคำนวณ
--     (ค่าเสื่อม/เดือน = 800,000 ÷ 60 = 13,333.33)
--
-- วิธีทดสอบ LSL-46:
--   เปิด LEASE-DEMO-46 → แท็บ Amortization Schedule → ดูข้อความเตือน + จำนวนงวด (36) + การ์ด ค่าเสื่อม/เดือน
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005046' or lease_no = 'LEASE-DEMO-46';
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000546c1' or contract_number = 'CA-LSL46-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000546a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000546a1' or ma_name = 'MA-LSL46-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000546a1','BBL','MA-LSL46-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000546a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000546c1','d9d9ea50-0000-0000-0000-0000000546a1',
   'CA-LSL46-DEMO (วงเงินสัญญาเช่า)', 'CA-LSL46-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ Lease Leasing (Active · term 36 · useful life 60)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005046','LEASE-DEMO-46','d9d9ea50-0000-0000-0000-0000000546c1','MGC','lease',
   false,'LSL46-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   0,0,0,4,60,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Active','seed LSL-46 · term 36 · useful life 60 → เตือน + งวด 37-60 ไม่แสดงแต่ยังคำนวณ','BANKREF-LSL46', now(), now());

-- ④ ตรวจผล
select lease_no, term_months, rou_useful_life, principal,
       round(principal / rou_useful_life, 2) as depr_per_month
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005046';
-- คาดหวัง: term 36 < useful life 60 → เตือนสีเหลือง · ค่าเสื่อม/เดือน = 800,000 ÷ 60 = 13,333.33
