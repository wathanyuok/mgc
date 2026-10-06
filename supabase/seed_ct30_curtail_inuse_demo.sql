-- ============================================================
-- Seed: CT-30 — ลบเงื่อนไข Curtailment ที่มีสัญญาสต๊อกรถใช้อยู่ → ถูกบล็อก (BR-MST-CT-003)
--
--   สร้าง 1 เงื่อนไข Curtailment + 1 Floor Plan ที่
--     - vendor ตรงกัน (CT30-DEMO-VENDOR)
--     - transaction_date ของ FP อยู่ในช่วง effective ของเงื่อนไข
--   → ลองลบเงื่อนไขนั้น → ระบบบล็อก "ถูกใช้อยู่ที่สินเชื่อสต๊อกรถ 1 รายการ"
--
-- วิธีทดสอบ CT-30:
--   เมนู Curtailment → หาแถว vendor "CT30-DEMO-VENDOR" → กดถังขยะ → ยืนยัน
--   → toast แดง: "ลบไม่ได้ — เงื่อนไขของ CT30-DEMO-VENDOR (New2024) ถูกใช้อยู่ที่สินเชื่อสต๊อกรถ 1 รายการ ..."
--
-- หมายเหตุ: การจับคู่ดู vendor + transaction_date ในช่วงเท่านั้น (ไม่ดูประเภทรถ)
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (รันซ้ำได้)
delete from floor_plans  where fp_no = 'FP-CT30-DEMO';
delete from curtailments where vendor = 'CT30-DEMO-VENDOR';

-- 1) เงื่อนไข Curtailment ที่จะถูกลบ (Active · มีช่วงวันที่ชัดเจน)
insert into curtailments
  (vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark)
values
  ('CT30-DEMO-VENDOR', 'New2024', date '2026-01-01', date '2026-12-31',
   90, 30, 180, 30, 270, 40,
   'Active', 'seed CT-30 · เงื่อนไขที่ถูกสัญญาสต๊อกรถใช้อยู่ → ลบไม่ได้');

-- 2) Floor Plan ที่ vendor ตรง + วันทำรายการอยู่ในช่วงของเงื่อนไข → ทำให้ลบเงื่อนไขไม่ได้
insert into floor_plans
  (fp_no, ca_id, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, total_amount, status, remark)
values
  ('FP-CT30-DEMO', null, 'KBANK', 'CT30-DEMO-VENDOR', 'bmw',
   date '2026-06-01', date '2026-06-01', 5000000, 'Active',
   'seed CT-30 · สัญญาสต๊อกรถที่ใช้เงื่อนไข curtailment ของ vendor นี้');

-- ตรวจผล
select vendor, vehicle_type, effective_start_date, effective_end_date, status
  from curtailments where vendor = 'CT30-DEMO-VENDOR';
select fp_no, vendor, transaction_date, status
  from floor_plans where fp_no = 'FP-CT30-DEMO';
-- คาดหวัง: ลบเงื่อนไข CT30-DEMO-VENDOR → บล็อก · "ถูกใช้อยู่ที่สินเชื่อสต๊อกรถ 1 รายการ"
