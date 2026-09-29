-- ============================================================
-- Seed (แยก): Curtailment master สำหรับ demo — vendor เฉพาะ ไม่ปนกับ BMW ที่มีหลายแถว
-- ให้ FP-DEMO-001 ใช้ curtailment ตัวนี้ตัวเดียว → ผลตารางล็อกแน่นอน
--   Tier: 90 วัน 10% · 180 วัน 10% · 270 วัน 80%
-- รันไฟล์นี้ "หลัง" seed FP (seed_lc_fp_od_tr_fxf_demo.sql) หรือรันเดี่ยวก็ได้
-- รันซ้ำได้ (ลบ curtailment demo ก่อน)
-- ============================================================

-- ① ลบ + สร้าง curtailment master เฉพาะ demo (vendor ไม่ซ้ำใคร)
delete from curtailments where vendor = 'MGC DEMO VENDOR';
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   tier4_days, tier4_pct, tier5_days, tier5_pct, tier6_days, tier6_pct,
   status, remark, created_at, updated_at)
values
  ('d9d9c000-0000-0000-0000-00000000cd01','MGC DEMO VENDOR','รถยนต์',
   date '2026-01-01', null,
   90,10, 180,10, 270,80,
   null,null, null,null, null,null,
   'Active','seed demo · curtailment 90/10 · 180/10 · 270/80', now(), now());

-- ② ชี้ FP-DEMO-001 ให้ใช้ vendor นี้ (จับคู่ curtailment ได้ตัวเดียว) + schedule_mode = bmw
update floor_plans
   set vendor = 'MGC DEMO VENDOR',
       schedule_mode = 'bmw',
       updated_at = now()
 where fp_no = 'FP-DEMO-001';

-- ตรวจผล
select vendor, vehicle_type, effective_start_date, tier1_days, tier1_pct,
       tier2_days, tier2_pct, tier3_days, tier3_pct, status
  from curtailments where vendor = 'MGC DEMO VENDOR';
select fp_no, vendor, schedule_mode from floor_plans where fp_no = 'FP-DEMO-001';
