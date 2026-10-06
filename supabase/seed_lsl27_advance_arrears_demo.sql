-- ============================================================
-- Seed: LSL-27 — ค่างวดชำระต้นงวด < ชำระปลายงวด (ตามหลักการคิดลด)
--
--   สัญญา Leasing คู่ ตั้งค่าเหมือนกันทุกอย่าง ต่างแค่ PAYMENT TYPE:
--     LEASE-DEMO-27A = ชำระปลายงวด (End of Period)   → arrears
--     LEASE-DEMO-27B = ชำระต้นงวด (Beginning of Period) → advance (ค่างวด = arrears ÷ (1+r) · ต่ำกว่า)
--   เงินต้น 1,000,000 · 10% · 36 งวด (อัตราสูงเพื่อให้เห็นส่วนต่างชัด)
--
-- วิธีทดสอบ LSL-27 (อ้างอิง seed นี้):
--   1. เปิด LEASE-DEMO-27A (ปลายงวด) → แท็บ Amortization Schedule → จดค่างวด (Installment)
--   2. เปิด LEASE-DEMO-27B (ต้นงวด) → จดค่างวด
--   ผล: ค่างวดของ 27B (ต้นงวด) ต่ำกว่า 27A (ปลายงวด)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id in ('d9d9ea50-0000-0000-0000-00000000527a','d9d9ea50-0000-0000-0000-00000000527b')
   or lease_no in ('LEASE-DEMO-27A','LEASE-DEMO-27B');
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000527c1' or contract_number = 'CA-LSL27-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000527a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000527a1' or ma_name = 'MA-LSL27-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000527a1','BBL','MA-LSL27-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000527a1','MGC',30000000,0,0);

-- ② CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000527c1','d9d9ea50-0000-0000-0000-0000000527a1',
   'CA-LSL27-DEMO (วงเงินสัญญาเช่า)', 'CA-LSL27-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   30000000, 'THB', 'Term', 'BBL',
   date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- acct_cards ชุด net/ROU ใช้ร่วมกันสองสัญญา (ประกาศเป็น CTE ไม่ได้ใน insert ธรรมดา จึงใส่ซ้ำ)
-- ③ LEASE-DEMO-27A — ชำระปลายงวด (arrears)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000527a','LEASE-DEMO-27A','d9d9ea50-0000-0000-0000-0000000527c1','MGC','lease',
   false,'LSL27A-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','ชำระปลายงวด (End of Period)','รถยนต์','รถตู้ Toyota Commuter (ปลายงวด)',
   null,'BBL',null,null,null,1000000,
   10,36, date '2026-09-01',0,'with-last',0,
   0,0,0,10,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-27A · ปลายงวด (arrears) · 1,000,000 · 10% · 36 งวด','BANKREF-LSL27A', now(), now());

-- ④ LEASE-DEMO-27B — ชำระต้นงวด (advance) · ค่าอื่นเหมือน 27A ทุกอย่าง
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000527b','LEASE-DEMO-27B','d9d9ea50-0000-0000-0000-0000000527c1','MGC','lease',
   false,'LSL27B-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','ชำระต้นงวด (Beginning of Period)','รถยนต์','รถตู้ Toyota Commuter (ต้นงวด)',
   null,'BBL',null,null,null,1000000,
   10,36, date '2026-09-01',0,'with-last',0,
   0,0,0,10,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-27B · ต้นงวด (advance) · เหมือน 27A ทุกอย่าง → ค่างวดต่ำกว่า','BANKREF-LSL27B', now(), now());

-- ⑤ ตรวจผล
select lease_no, payment_type, principal, annual_rate, term_months
  from leases where id in ('d9d9ea50-0000-0000-0000-00000000527a','d9d9ea50-0000-0000-0000-00000000527b')
  order by lease_no;
-- คาดหวัง: 27A ปลายงวด · 27B ต้นงวด → ค่างวด (Installment) ของ 27B ต่ำกว่า 27A
