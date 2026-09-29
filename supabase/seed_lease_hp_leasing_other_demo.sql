-- ============================================================
-- Seed: Lease 3 mode — HP / Leasing / Lease Other · FIELD ครบทุกช่อง
-- สาย MA → CA(HP) + CA(LEASE) → leases (hp, lease, other)
-- acct_cards ใส่ "เฉพาะบัญชีที่ใช้จริงต่อ mode" (role ที่ไม่ใส่ ระบบใช้ default ให้เอง):
--   HP (gross method)  = ROU · Lease Liab · Deferred Int · Undue VAT · Int Exp · AP Lease · Cash · Dep · Accum Dep  (9)
--   Leasing/Lease Other (net/ROU/TFRS16) = ROU · Lease Liab · Int Exp · Cash · Dep · Accum Dep · Gain(Loss)  (7)
-- ข้อบังคับ: mode='other' ต้อง ca_id = NULL (constraint leases_ca_required_by_mode)
-- รันซ้ำได้ (ลบ lease ก่อน · MA/CA ใช้ upsert)
-- ============================================================

delete from leases
 where lease_no in ('HP-DEMO-001','LEASE-DEMO-001','LSO-DEMO-001')
    or id in ('d9d9ea50-0000-0000-0000-0000000000f1',
              'd9d9ea50-0000-0000-0000-0000000000f2',
              'd9d9ea50-0000-0000-0000-0000000000f3');

-- ① MA
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000a1', 'MA-DEMO-LEASE', 'BBL', 'MGC', 'Approved',
   date '2026-01-01', date '2031-12-31', 80000000, 1800000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed Lease 3 mode · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name=excluded.ma_name, finance_institution=excluded.finance_institution,
  subsidiary=excluded.subsidiary, status=excluded.status, start_date=excluded.start_date,
  end_date=excluded.end_date, credit_line=excluded.credit_line, utilization=excluded.utilization,
  guarantee_remark=excluded.guarantee_remark, inactive=excluded.inactive, remark=excluded.remark, updated_at=now();

delete from ma_subsidiaries where ma_id='d9d9ea50-0000-0000-0000-0000000000a1';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000000a1','MGC',80000000,1800000,0);

-- ② CA (HP) — facility HP · acct_cards = ชุด HP (9)
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards, start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000c1','CA เดโม — วงเงินเช่าซื้อ (HP)','CA-DEMO-HP',
   'd9d9ea50-0000-0000-0000-0000000000a1','MGC',
   (select id from facility_types where code='HP' limit 1),
   30000000, 1000000, 'THB','Term','BBL',
   false,0,0,'วงเงินเช่าซื้อยานพาหนะ (Hire Purchase)','REF-CA-HP-2026',
   'seed · CA วงเงิน HP','ค้ำโดยบริษัทแม่ MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[
     {"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"DEFERRED INTEREST","gl":"1501106 ดอกเบี้ยรอตัดบัญชี Hire purchase-สัญญาเช่าซื้อ"},
     {"id":"ac-4","type":"UNDUE INPUT VAT","gl":"1191204 ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)"},
     {"id":"ac-5","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-6","type":"AP LEASE ACCOUNT","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"},
     {"id":"ac-7","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-8","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-9","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"}
   ]'::jsonb,
   date '2026-01-01', date '2031-12-31','Approved',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ca_name=excluded.ca_name, facility_type_id=excluded.facility_type_id,
  rate_cards=excluded.rate_cards, acct_cards=excluded.acct_cards, status=excluded.status, updated_at=now();

-- ② CA (LEASE) — facility LEASE (Leasing) · acct_cards = ชุด net/ROU (7)
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards, start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000c2','CA เดโม — วงเงินสัญญาเช่า (Lease)','CA-DEMO-LEASE',
   'd9d9ea50-0000-0000-0000-0000000000a1','MGC',
   (select id from facility_types where code='LEASE' limit 1),
   50000000, 800000, 'THB','Term','BBL',
   false,0,0,'วงเงินสัญญาเช่า (Leasing)','REF-CA-LEASE-2026',
   'seed · CA วงเงิน Lease','ค้ำโดยบริษัทแม่ MGC',
   '[{"id":"rc-1","type":"Fixed","rate":4,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[
     {"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ใช้ชั่วคราว — Re-measure Gain/(Loss))"}
   ]'::jsonb,
   date '2026-01-01', date '2031-12-31','Approved',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ca_name=excluded.ca_name, facility_type_id=excluded.facility_type_id,
  rate_cards=excluded.rate_cards, acct_cards=excluded.acct_cards, status=excluded.status, updated_at=now();

-- ③ Lease HP (mode=hp) — เช่าซื้อรถ · acct_cards ชุด HP (9)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000f1','HP-DEMO-001','d9d9ea50-0000-0000-0000-0000000000c1','MGC','hp',
   false,'HP-CONTRACT-001', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2030-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถกระบะ Toyota Hilux Revo',
   'MR0FR22G100000001','BBL',1200000,200000,1000000,1000000,
   5,48, date '2026-09-01',0,'with-last',0,
   0,0,0,5,48,7,
   true,false,true,true, null,
   '[
     {"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"DEFERRED INTEREST","gl":"1501106 ดอกเบี้ยรอตัดบัญชี Hire purchase-สัญญาเช่าซื้อ"},
     {"id":"ac-4","type":"UNDUE INPUT VAT","gl":"1191204 ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)"},
     {"id":"ac-5","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-6","type":"AP LEASE ACCOUNT","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"},
     {"id":"ac-7","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-8","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-9","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"}
   ]'::jsonb,
   null,'Draft','seed HP · เช่าซื้อรถ 1,000,000 · 5% · 48 งวด (gross method)','BANKREF-HP-001', now(), now());

-- ③ Lease Leasing (mode=lease) — เช่าการเงิน (ROU) · acct_cards ชุด net (7)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000f2','LEASE-DEMO-001','d9d9ea50-0000-0000-0000-0000000000c2','MGC','lease',
   false,'LEASE-CONTRACT-001', date '2026-09-01','Finance',
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
   null,'Draft','seed Leasing · เช่าการเงิน 800,000 · 4% · 36 งวด (net/ROU)','BANKREF-LEASE-001', now(), now());

-- ③ Lease Other (mode=other) — เช่าอาคาร (TFRS16) · ca_id = NULL (constraint) · acct_cards ชุด net (7)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-0000000000f3','LSO-DEMO-001', null,'MGC','other',
   false,'LSO-CONTRACT-001', date '2026-09-01','Operating',
   'Monthly', date '2026-09-30', date '2031-09-29','Fix Installment / Fix Installment & Step payment','อาคาร','สำนักงานให้เช่า อาคาร A ชั้น 10',
   null,'BBL',null,null,null,900000,
   0,60, date '2026-09-01',0,'with-last',50000,
   0,0,0,3.5,60,7,
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
   null,'Draft','seed Lease Other · เช่าอาคาร 900,000 · discount 3.5% · 60 งวด · upfront 50,000 (net/ROU)','BANKREF-LSO-001', now(), now());

-- ตรวจผล
select lease_no, mode, classification, principal, term_months,
       jsonb_array_length(acct_cards) as acct_count, status
  from leases
 where lease_no in ('HP-DEMO-001','LEASE-DEMO-001','LSO-DEMO-001')
 order by lease_no;
