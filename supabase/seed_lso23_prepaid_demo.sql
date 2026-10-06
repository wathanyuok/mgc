-- ============================================================
-- Seed: LSO-23 — เงินจ่ายล่วงหน้า (Prepaid) ของ Lease Other
--
--   LSO-DEMO-23 (mode=other · ca_id NULL ตาม constraint · Active)
--     PRINCIPAL 800,000 · PREPAID PERIODS 2 · PREPAID AMOUNT 50,000
--   คาดหวัง:
--     งวดท้าย 2 งวด → Installment = 0 · Note "Prepaid (จ่ายแล้ววันแรก)"
--     ROU = 800,000 (รวม prepaid) · หนี้สิน = 800,000 − 50,000 = 750,000 (ไม่รวม prepaid)
--
-- หมายเหตุ: Lease Other ไม่ผูกวงเงิน (ca_id = NULL) · asset = อาคาร · classification = Operating
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005023' or lease_no = 'LSO-DEMO-23';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005023','LSO-DEMO-23',null,'MGC','other',
   false,'LSO23-CONTRACT', date '2026-09-01','Operating',
   'Monthly', date '2026-09-30', date '2029-09-29','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 5',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-09-01',0,'with-last',0,
   0,2,50000,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"}]'::jsonb,
   null,'Active','seed LSO-23 · prepaid 2 งวด · 50,000 → งวดท้าย 2 งวด Installment 0 · ROU 800k · หนี้สิน 750k','BANKREF-LSO23', now(), now());

-- ตรวจผล
select lease_no, mode, status, principal, prepaid_periods, prepaid_amount,
       principal as rou_asset,
       (principal - coalesce(prepaid_amount,0) - coalesce(upfront_payment,0)) as lease_liability
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005023';
-- คาดหวัง: prepaid 2 งวด · ROU 800,000 · หนี้สิน 750,000 · งวดท้าย 2 งวด Installment 0 + note Prepaid
