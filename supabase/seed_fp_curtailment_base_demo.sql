-- ============================================================
-- Seed: FP-56 — ยอดลดต้น (Curtailment) คิดจากยอดเบิกจริง ไม่ใช่เพดานวงเงิน
-- เพดาน (AMOUNT / Facility) = 2,000,000  ·  รถรวม (chassisSum) = 1,000,000
-- โหมด Curtailment Schedule · vendor ไม่มีในทะเบียน → ใช้ default 90/180/270 = 10/10/80%
--
-- คาดหวังในแท็บ Schedule Calculate คอลัมน์ Curtailment:
--   90d  → 10% ของ 1,000,000 = 100,000
--   180d → 10% ของ 1,000,000 = 100,000
--   270d → 80% ของ 1,000,000 = 800,000
--   รวม = 1,000,000 (เท่ายอดเบิกจริง ไม่ใช่ 2,000,000 ของเพดาน)
-- ============================================================
begin;

delete from fp_chassis
 where fp_id in (select id from floor_plans where fp_no = 'FP-SEED-CURTAIL');
delete from floor_plans where fp_no = 'FP-SEED-CURTAIL';

-- FP : 11111111-1111-1111-1111-1111111111c6
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, status, rate_cards)
values
  ('11111111-1111-1111-1111-1111111111c6', 'FP-SEED-CURTAIL', 'FP-SEED-CURTAIL',
   'KBANK', 'ผู้จำหน่ายไม่มีในทะเบียน', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01',
   2000000, 2000000, 1000000, 'THB', 'Active',
   '[{"id":"aaaaaaaa-0000-0000-0000-0000000000c6","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- รถ 2 คัน คันละ 500,000 → ยอดเบิกรวม 1,000,000 (< เพดาน 2,000,000)
insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('11111111-1111-1111-1111-1111111111c6', 'CURTAILCHASSIS-001', 'BMW 320d', date '2026-05-01', 500000, 500000, 'In Stock', 0),
  ('11111111-1111-1111-1111-1111111111c6', 'CURTAILCHASSIS-002', 'BMW 520d', date '2026-05-01', 500000, 500000, 'In Stock', 1);

commit;

-- ตรวจ: เปิด FP-SEED-CURTAIL → แท็บ Schedule Calculate (โหมด Curtailment Schedule)
--   ดูคอลัมน์ Curtailment: 100,000 · 100,000 · 800,000 (รวม 1,000,000 = ยอดเบิกจริง)
--   ถ้าคิดจากเพดาน (ผิด) จะเป็น 200,000 · 200,000 · 1,600,000 (รวม 2,000,000)
