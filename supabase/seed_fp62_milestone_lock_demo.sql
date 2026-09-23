-- =====================================================================
-- Seed: FP-62 — ล็อกเมื่อเลยงวดลดต้น (Curtailment Milestone) แล้ว
-- =====================================================================
-- สร้าง: ตารางลดต้น (curtailments) ของ BMW + FP โหมด Curtailment Schedule
--        ที่ transaction_date เก่าพอจนงวดลดต้นงวดแรก (90 วัน) เลยไปแล้ว
--   วันนี้ ~23/09/2026 · transaction_date = 01/05/2026 → ผ่านไป ~145 วัน
--   งวด tier1 = 90 วัน  ≤ 145 → เลยไปแล้ว → banner ขึ้น + TRANSACTION DATE ล็อก
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-MILESTONE
--   2) Primary Information → ช่อง TRANSACTION DATE จาง + ไอคอนกุญแจ (แก้ไม่ได้)
--   3) แท็บ Schedule Calculate → บนสุดมีแถบสีส้ม
--        "⚠ Settlement Step 90d ผ่านไปแล้ว — เปลี่ยน mode / Transaction Date ไม่ได้"
--   4) ลองแก้ MATURITY DATE / Cap % / เพิ่ม Chassis → ยังแก้ได้ปกติ
--
-- รันซ้ำได้ (ลบรถ → FP → CA → MA → curtailment)
-- =====================================================================

delete from fp_chassis where fp_id = 'c3c3c3c3-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-MILESTONE';
delete from credit_agreements where contract_number = 'CA-DEMO-FP62';
delete from ma_subsidiaries   where ma_id = 'c3c3c3c3-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = 'c3c3c3c3-0000-0000-0000-0000000000a0';
delete from curtailments where vendor = 'BMW (Thailand) Co., Ltd.' and remark = 'seed FP-62 · ตารางลดต้น 3 งวด';

-- ① ตารางลดต้น (Curtailment Master) ของ BMW · 3 งวด (90/180/270 วัน)
insert into curtailments
  (vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct, status, remark)
values
  ('BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', null,
   90, 30, 180, 30, 270, 40, 'Active', 'seed FP-62 · ตารางลดต้น 3 งวด');

-- ② MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('c3c3c3c3-0000-0000-0000-0000000000a0', 'KBANK', 'MA-DEMO-FP62', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c3c3c3c3-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ③ CA · ประเภท FP
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('c3c3c3c3-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP62)', 'CA-DEMO-FP62',
   'c3c3c3c3-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ④ Floor Plan · โหมด Curtailment (bmw) · transaction เก่า (เลยงวด 90d) · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, cap_pct, status, rate_cards)
values
  ('c3c3c3c3-0000-0000-0000-0000000000f0', 'FP-DEMO-MILESTONE', 'FP เดโม — เลยงวดลดต้นแล้ว',
   'c3c3c3c3-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', null, 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01',
   8250000, 8250000, 6600000, 'THB', 80, 'Roll Over',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb);
-- หมายเหตุ: ใช้สถานะ 'Roll Over' เพื่อให้ทดสอบ FP-62 ด้วยบัญชีใดก็ได้
--   Roll Over เข้าเงื่อนไข milestone แต่ไม่โดน approval lock (ที่ล็อกเฉพาะ Active/Approved)
--   → เห็น milestone lock ชัด: TRANSACTION DATE ล็อก · MATURITY/CAP/Chassis แก้ได้

-- ⑤ รถ 3 คัน · ครบทุก field · เบิก = 80% ของราคา
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, status,
   original_location, current_location, location_modified_at, sold_date, sort_order)
values
  ('c3c3c3c3-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100001', 'B48-100001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 0),
  ('c3c3c3c3-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100002', 'B48-100002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 1),
  ('c3c3c3c3-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100003', 'B48-100003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 2);
