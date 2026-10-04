-- ============================================================
-- Seed: AT-07B / FR-SEC-003 — Audit Trail เมนูแม่รวมส่วนย่อย (Floor Plan)
--
--   แนวทาง: seed สัญญา Floor Plan Active + รถในสต๊อก ไว้ให้ผู้ทดสอบ "ทำรายการจริงผ่าน UI"
--   2 อย่าง → เกิด audit log จริง (ไม่ยัด audit ปลอม):
--     1) แก้ตัวสัญญา     → log ตาราง floor_plans
--     2) โอนเข้า FA      → log ตาราง fa_transfers
--   ทั้งคู่ถูกจัดกลุ่มใต้เมนูแม่ "Floor Plan" ในตัวกรอง Audit Trail
--
-- วิธีทดสอบ AT-07B (อ้างอิง seed นี้):
--   1. เปิด FP-AT07B → แก้ตัวสัญญา (เช่น remark) → Save            (→ audit: floor_plans)
--   2. แท็บ FA Transfer → โอนรถ FP-AT07B-CHS-001 เข้าทรัพย์สินถาวร  (→ audit: fa_transfers)
--   3. เมนู Audit Trail → ตัวกรองโมดูล = "Floor Plan" (ปรับช่วงวันที่ให้คลุมวันนี้)
--   ผล: เห็นทั้ง 2 รายการ · คอลัมน์โมดูล = "Floor Plan" ทั้งคู่
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================
begin;

-- ล้างของเดิม
delete from fp_chassis where fp_id = 'a7000000-0000-0000-0000-00000000a07b';
delete from fa_transfers where facility_id = 'a7000000-0000-0000-0000-00000000a07b';
delete from floor_plans where id = 'a7000000-0000-0000-0000-00000000a07b' or fp_no = 'FP-AT07B';

-- Floor Plan (Active) + ผังบัญชีสำหรับโอน FA
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, status, rate_cards, acct_cards, remark)
values
  ('a7000000-0000-0000-0000-00000000a07b', 'FP-AT07B', 'FP-AT07B (ทดสอบ Audit เมนูแม่)',
   'KBANK', 'Vendor Demo AT07B', 'bmw',
   date '2026-07-01', date '2026-07-01', date '2026-12-31', date '2026-12-31',
   2000000, 2000000, 1000000, 'THB', 'Active',
   '[{"id":"r1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 สินค้าคงเหลือ-Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เจ้าหนี้ค่ารถ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   'seed AT-07B · Active พร้อมแก้สัญญา + โอน FA เพื่อสร้าง audit 2 ตารางใต้เมนู Floor Plan');

-- รถในสต๊อก 2 คัน (ไว้โอนเข้า FA 1 คัน · อีกคันเผื่อ)
insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('a7000000-0000-0000-0000-00000000a07b', 'FP-AT07B-CHS-001', 'BMW 320d', date '2026-07-01', 500000, 500000, 'In Stock', 0),
  ('a7000000-0000-0000-0000-00000000a07b', 'FP-AT07B-CHS-002', 'BMW 520d', date '2026-07-01', 500000, 500000, 'In Stock', 1);

commit;

-- ตรวจผล: FP Active พร้อมรถในสต๊อก (ไว้กดแก้ + โอน FA ผ่าน UI)
select f.fp_no, f.status, count(c.id) as chassis_in_stock
  from floor_plans f
  left join fp_chassis c on c.fp_id = f.id and c.status = 'In Stock'
 where f.id = 'a7000000-0000-0000-0000-00000000a07b'
 group by f.fp_no, f.status;
-- คาดหวัง: FP-AT07B · Active · chassis_in_stock = 2 → ทำรายการ 2 อย่างแล้วไปกรอง Audit = Floor Plan
