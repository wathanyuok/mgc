-- ============================================================
-- Seed: LSO-39 — ใบสำคัญวันแรกใช้ผังบัญชี ROU ตั้งต้นของ Lease Other
--
--   LSO-DEMO-39 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   *** acct_cards = [] (ว่าง) โดยตั้งใจ ***
--     ไม่มีแท็บ Accounting แล้ว · ไม่ผูกบัญชีเอง → resolveLeaseGL ใช้ค่าตั้งต้น FINANCE_GL
--
--   คาดหวัง ใบสำคัญวันแรกใช้รหัสชุด ROU (ไม่ใช่ชุด HP):
--     สิทธิการใช้สินทรัพย์   = 1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ
--     หนี้สินตามสัญญาเช่า     = 2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ
--     ดอกเบี้ยจ่าย           = 5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ
--
-- วิธีทดสอบ LSO-39:
--   เปิด LSO-DEMO-39 → ลงบัญชีวันแรก → เปิดใบสำคัญ ดูรหัสบัญชีแต่ละบรรทัด = ชุด ...104 (ROU)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005039' or lease_no = 'LSO-DEMO-39';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005039','LSO-DEMO-39',null,'MGC','other',
   false,'LSO39-CONTRACT', date '2026-05-01','Operating',
   'Monthly', date '2026-05-31', date '2029-05-30','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 9',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-05-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-39 · acct_cards ว่าง → ใบสำคัญใช้ค่าตั้งต้น FINANCE_GL ชุด ...104 (ROU)','BANKREF-LSO39', now(), now());

-- ตรวจผล
select lease_no, mode, status, principal, acct_cards
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005039';
-- คาดหวัง: acct_cards = [] → ลงบัญชีวันแรก ใช้ 1431104 / 2322104 / 5513104 (ROU) อัตโนมัติ
