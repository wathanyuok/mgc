-- ============================================================
-- Seed: LSO-46 — การ์ด ROU Asset เปลี่ยนเป็นค่าหลังปรับปรุงสัญญา
--
--   LSO-DEMO-46 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   สัญญาพร้อมทดสอบ Re-measurement:
--     การ์ดเริ่มต้น = ROU Asset (ตั้งต้น) 800,000
--     หลังปรับปรุง (NEW ROU 900,000) → การ์ด = ROU Asset (หลังปรับปรุงสัญญา) 900,000
--
-- วิธีทดสอบ LSO-46:
--   1) เปิด LSO-DEMO-46 (Active) → ดูการ์ด ROU Asset (ตั้งต้น) = 800,000
--   2) 📐 Re-measurement → NEW ROU ASSET 900,000 · NEW LEASE LIABILITY 820,000 → ส่งคำขอปรับปรุงมูลค่า
--   3) อีก user (ผู้อนุมัติ ≠ ผู้ขอ) เปิดสัญญา → กด "อนุมัติปรับปรุงมูลค่า"
--   4) การ์ดเปลี่ยนเป็น ROU Asset (หลังปรับปรุงสัญญา) = 900,000 · สถานะ Modified
--
-- *** ต้องใช้ 2 users: ผู้ขอ ≠ ผู้อนุมัติ (blockSelfRemeasure) ***
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005046' or lease_no = 'LSO-DEMO-46';
-- ล้างเวอร์ชัน/ใบสำคัญเก่าของสัญญานี้ (เผื่อรันทดสอบซ้ำ)
delete from lease_versions where lease_id = 'd9d9ea50-0000-0000-0000-000000005046';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005046','LSO-DEMO-46',null,'MGC','other',
   false,'LSO46-CONTRACT', date '2026-05-01','Operating',
   'Monthly', date '2026-05-31', date '2029-05-30','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 14',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-05-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[]'::jsonb,
   null,'Active','seed LSO-46 · Active พร้อมทดสอบ Re-measurement (ROU 800k → 900k)','BANKREF-LSO46', now(), now());

-- ตรวจผล
select lease_no, mode, status, principal
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005046';
-- คาดหวัง: Active · ROU (ตั้งต้น) 800,000 → หลังอนุมัติปรับปรุง การ์ดเป็น (หลังปรับปรุงสัญญา) 900,000
