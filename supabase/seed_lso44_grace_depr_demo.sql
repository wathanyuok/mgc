-- ============================================================
-- Seed: LSO-44 — ค่าเสื่อม ROU ตัดตั้งแต่งวดแรกแม้อยู่ในช่วงพักชำระ
--
--   LSO-DEMO-44 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   *** GRACE PERIOD = 3 งวด · PAYMENT TYPE = Grace Period and Fix Installment ***
--     งวด 1–3: INSTALLMENT = 0 (พักชำระ)
--     แต่คอลัมน์ DEPRECIATION เดินตั้งแต่งวด 1 = 800,000 ÷ 36 = 22,222.22 / งวด
--
--   คาดหวัง:
--     ค่าเสื่อม/เดือน (เส้นตรง) = 22,222.22
--     งวด 1 มี DEPRECIATION 22,222.22 ทั้งที่ INSTALLMENT = 0
--     ข้อความใต้ตาราง: "สิทธิการใช้สินทรัพย์ตัดค่าเสื่อมแบบเส้นตรงตั้งแต่งวดแรก แม้อยู่ในช่วงปลอดชำระ"
--
-- วิธีทดสอบ LSO-44:
--   เปิด LSO-DEMO-44 → เลื่อนไปตารางผ่อน (ROU) → ดูคอลัมน์ DEPRECIATION งวด 1–3 เทียบกับ INSTALLMENT
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005044' or lease_no = 'LSO-DEMO-44';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005044','LSO-DEMO-44',null,'MGC','other',
   false,'LSO44-CONTRACT', date '2026-11-01','Operating',
   'Monthly', date '2026-11-30', date '2029-11-29','Grace Period and Fix Installment','อาคาร','อาคารสำนักงาน ชั้น 11',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-11-01',0,'with-last',0,
   3,0,0,4,36,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-44 · grace 3 งวด · ค่างวด 1–3 = 0 แต่ค่าเสื่อมเดินตั้งแต่งวด 1 (22,222.22/งวด)','BANKREF-LSO44', now(), now());

-- ตรวจผล
select lease_no, mode, status, grace_periods, payment_type, principal, rou_useful_life,
       round(principal::numeric / rou_useful_life, 2) as depr_per_period
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005044';
-- คาดหวัง: grace 3 · depr_per_period = 22,222.22 · งวด 1 DEPRECIATION 22,222.22 แต่ INSTALLMENT 0
