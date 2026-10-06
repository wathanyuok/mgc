-- ============================================================
-- Seed: LSO-40 — งวดของ Lease Other ปรากฏในรายงานครบกำหนดชำระ (Due Payment Report)
--
--   LSO-DEMO-40 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   *** payment start = 30/11/2026 (อนาคต) ***
--     เพื่อให้ทุกงวดยัง "ไม่ถึงกำหนด" → โผล่ในแท็บ Due Payment Report
--     (ถ้าใช้สัญญาที่งวดเลยกำหนดแล้ว จะไปอยู่ Overdue Payment Report แทน)
--
-- วิธีทดสอบ LSO-40:
--   1) เปิด LSO-DEMO-40 แล้วกด Save 1 ครั้ง → ระบบ sync งวดเข้าตารางผ่อนกลาง (installment_schedules)
--   2) ไป Reports → Due Payment Report → ค้นหา "LSO-DEMO-40"
--   3) เห็นงวดของสัญญาเป็นแถว · Transaction Number = LSO-DEMO-40 · Period / Due Payment Date / ยอดงวด
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005040' or lease_no = 'LSO-DEMO-40';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005040','LSO-DEMO-40',null,'MGC','other',
   false,'LSO40-CONTRACT', date '2026-11-01','Operating',
   'Monthly', date '2026-11-30', date '2029-11-29','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 10',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-11-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-40 · งวดอนาคต (เริ่ม 30/11/2026) → โผล่ใน Due Payment Report หลังเปิดแล้ว Save','BANKREF-LSO40', now(), now());

-- ตรวจผล
select lease_no, mode, status, payment_start_date, end_date, principal, term_months
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005040';
-- คาดหวัง: หลังเปิดสัญญาแล้วกด Save → installment_schedules มี 36 งวด
--          Reports → Due Payment Report ค้นหา LSO-DEMO-40 เห็นงวดทั้งหมด (ยังไม่ถึงกำหนด)
