-- ============================================================
-- Seed: LSO-45 — สิทธิการใช้สินทรัพย์ตั้งต้น = จำนวนเงิน (รวม upfront + prepaid)
--
--   LSO-DEMO-45 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   UPFRONT 50,000 · PREPAID PERIODS 2 · PREPAID AMOUNT 50,000
--
--   คาดหวัง:
--     การ์ด ROU Asset (ตั้งต้น) = 800,000  (= PRINCIPAL เต็ม ไม่บวก upfront/prepaid ซ้ำ)
--     ใบสำคัญวันแรก:
--       Dr 1431104 สิทธิการใช้สินทรัพย์      800,000
--       Cr 2322104 หนี้สินตามสัญญาเช่า ROU    700,000  = 800,000 − 50,000 − 50,000
--       Cr 1001201 เงินสด (Upfront)            50,000
--       Cr 1001201 เงินสด (Prepaid งวดท้าย)    50,000
--
-- วิธีทดสอบ LSO-45:
--   เปิด LSO-DEMO-45 → ดูการ์ด ROU Asset (ตั้งต้น) = 800,000
--   → ลงบัญชีวันแรก → เปิดใบสำคัญ ดู Cr หนี้สิน = 700,000
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005045' or lease_no = 'LSO-DEMO-45';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005045','LSO-DEMO-45',null,'MGC','other',
   false,'LSO45-CONTRACT', date '2026-05-01','Operating',
   'Monthly', date '2026-05-31', date '2029-05-30','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 12',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-05-01',0,'with-last',50000,
   0,2,50000,4,36,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-45 · upfront 50k + prepaid 50k → ROU 800k · หนี้สิน 700k','BANKREF-LSO45', now(), now());

-- ตรวจผล
select lease_no, mode, status, principal,
       upfront_payment, prepaid_periods, prepaid_amount,
       principal as rou_initial,
       (principal - coalesce(upfront_payment,0) - coalesce(prepaid_amount,0)) as lease_liability
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005045';
-- คาดหวัง: rou_initial 800,000 · lease_liability 700,000
