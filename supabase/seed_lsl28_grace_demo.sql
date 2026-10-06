-- ============================================================
-- Seed: LSL-28 — งวดพักชำระ (Grace): HP จ่ายแต่ดอกเบี้ย · Leasing ค่างวด 0
--
--   HP-DEMO-28  (mode=hp)   · grace 3 งวด → งวด 1-3 จ่ายเฉพาะดอกเบี้ย · note "Grace"
--   LEASE-DEMO-28 (mode=lease) · grace 3 งวด → งวด 1-3 ค่างวด 0 · note "Grace"
--
-- วิธีทดสอบ LSL-28 (อ้างอิง seed นี้):
--   1. เปิด HP-DEMO-28 → แท็บ Amortization Schedule → งวด 1-3: Note "Grace" · Installment = ดอกเบี้ยอย่างเดียว
--   2. เปิด LEASE-DEMO-28 → งวด 1-3: Note "Grace" · Installment = 0
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id in ('d9d9ea50-0000-0000-0000-00000000528a','d9d9ea50-0000-0000-0000-00000000528b')
   or lease_no in ('HP-DEMO-28','LEASE-DEMO-28');
delete from credit_agreements where id in ('d9d9ea50-0000-0000-0000-0000000528c1','d9d9ea50-0000-0000-0000-0000000528c2')
   or contract_number in ('CA-LSL28-HP','CA-LSL28-LEASE');
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000528a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000528a1' or ma_name = 'MA-LSL28-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000528a1','BBL','MA-LSL28-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 40000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000528a1','MGC',40000000,0,0);

-- ② CA (HP) + CA (LEASE)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000528c1','d9d9ea50-0000-0000-0000-0000000528a1',
   'CA-LSL28-HP (วงเงินเช่าซื้อ)', 'CA-LSL28-HP', 'MGC',
   (select id from facility_types where code='HP' limit 1),
   20000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb),
  ('d9d9ea50-0000-0000-0000-0000000528c2','d9d9ea50-0000-0000-0000-0000000528a1',
   'CA-LSL28-LEASE (วงเงินสัญญาเช่า)', 'CA-LSL28-LEASE', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   20000000, 'THB', 'Term', 'BBL', date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ HP (grace 3 → จ่ายแต่ดอกเบี้ย)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000528a','HP-DEMO-28','d9d9ea50-0000-0000-0000-0000000528c1','MGC','hp',
   false,'LSL28HP-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2030-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถกระบะ Toyota Hilux Revo',
   'MR0FR22G280000028','BBL',1200000,200000,1000000,1000000,
   5,48, date '2026-09-01',0,'with-last',0,
   3,0,0,5,48,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"DEFERRED INTEREST","gl":"1501106 ดอกเบี้ยรอตัดบัญชี Hire purchase"},
     {"id":"ac-4","type":"UNDUE INPUT VAT","gl":"1191204 ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)"},
     {"id":"ac-5","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-6","type":"AP LEASE ACCOUNT","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"},
     {"id":"ac-7","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-8","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-9","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"}]'::jsonb,
   null,'Draft','seed LSL-28 HP · grace 3 งวด → งวด 1-3 จ่ายแต่ดอกเบี้ย','BANKREF-LSL28HP', now(), now());

-- ④ Leasing (grace 3 → ค่างวด 0)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-00000000528b','LEASE-DEMO-28','d9d9ea50-0000-0000-0000-0000000528c2','MGC','lease',
   false,'LSL28LS-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2029-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถตู้ Toyota Commuter',
   null,'BBL',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   3,0,0,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Draft','seed LSL-28 Leasing · grace 3 งวด → งวด 1-3 ค่างวด 0','BANKREF-LSL28LS', now(), now());

-- ⑤ ตรวจผล
select lease_no, mode, grace_periods, principal, annual_rate, term_months
  from leases where id in ('d9d9ea50-0000-0000-0000-00000000528a','d9d9ea50-0000-0000-0000-00000000528b')
  order by lease_no;
-- คาดหวัง: HP-DEMO-28 (hp, grace 3 → ดอกเบี้ยอย่างเดียว) · LEASE-DEMO-28 (lease, grace 3 → ค่างวด 0)
