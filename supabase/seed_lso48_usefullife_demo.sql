-- ============================================================
-- Seed: LSO-48 — อายุการใช้งาน ROU ยาวกว่าอายุสัญญา
--
--   LSO-DEMO-48 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   *** ROU USEFUL LIFE = 60 เดือน (ยาวกว่าอายุสัญญา 36) ***
--
--   คาดหวัง:
--     ใต้ช่อง ROU USEFUL LIFE: เตือนเหลือง "อายุการใช้งาน (60) ยาวกว่าอายุสัญญา (36) ..."
--     เหนือตารางผ่อน: เตือนเหลือง "ค่าเสื่อมงวดที่ 37 ถึง 60 เกิดหลังจบสัญญา จึงไม่มีในตารางนี้"
--     ตารางแสดง 36 งวด · ค่าเสื่อม/เดือน = 800,000 ÷ 60 = 13,333.33
--
-- วิธีทดสอบ LSO-48:
--   เปิด LSO-DEMO-48 → ดูเตือนใต้ช่อง ROU USEFUL LIFE + เหนือตารางผ่อน + การ์ดค่าเสื่อม/เดือน = 13,333.33
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005048' or lease_no = 'LSO-DEMO-48';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005048','LSO-DEMO-48',null,'MGC','other',
   false,'LSO48-CONTRACT', date '2026-05-01','Operating',
   'Monthly', date '2026-05-31', date '2029-05-30','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 16',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-05-01',0,'with-last',0,
   0,0,0,4,60,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-48 · useful life 60 > term 36 → เตือนเหลือง 2 จุด · ค่าเสื่อม/เดือน 13,333.33','BANKREF-LSO48', now(), now());

-- ตรวจผล
select lease_no, mode, status, term_months, rou_useful_life, principal,
       round(principal::numeric / rou_useful_life, 2) as depr_per_period
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005048';
-- คาดหวัง: term 36 · useful life 60 · depr_per_period 13,333.33 · ตารางแสดง 36 งวด
