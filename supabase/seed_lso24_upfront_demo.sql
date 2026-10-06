-- ============================================================
-- Seed: LSO-24 — เงินจ่ายวันแรก (Upfront) ของ Lease Other
--
--   LSO-DEMO-24 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · UPFRONT 50,000 · prepaid 0
--   คาดหวัง:
--     ROU = 800,000 (รวม upfront) · หนี้สิน = 800,000 − 50,000 = 750,000
--     ใบสำคัญวันแรกมีบรรทัด Cr เงินสด 50,000 ("Upfront payment at Day 1")
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005024' or lease_no = 'LSO-DEMO-24';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005024','LSO-DEMO-24',null,'MGC','other',
   false,'LSO24-CONTRACT', date '2026-09-01','Operating',
   'Monthly', date '2026-09-30', date '2029-09-29','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 6',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',50000,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Active','seed LSO-24 · upfront 50,000 → หนี้สิน 750,000 · ใบสำคัญวันแรกมี Cr เงินสด 50,000','BANKREF-LSO24', now(), now());

-- ตรวจผล
select lease_no, mode, status, principal, upfront_payment,
       principal as rou_asset,
       (principal - coalesce(upfront_payment,0) - coalesce(prepaid_amount,0)) as lease_liability
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005024';
-- คาดหวัง: ROU 800,000 · หนี้สิน 750,000 · ลงบัญชีวันแรก → Cr เงินสด 50,000
