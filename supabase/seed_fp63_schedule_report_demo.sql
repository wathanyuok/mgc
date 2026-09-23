-- =====================================================================
-- Seed: FP-63 — ตารางงวด (ลดต้น) ในรายงานกลาง (Due / Overdue)
-- =====================================================================
-- สาย MA → CA → FP (โหมด Curtailment) + ตารางลดต้น 3 งวด + รถ 3 คัน
-- ตั้งวันให้ milestone คร่อมวันนี้ (23/09/2026) → ได้ทั้ง Due และ Overdue:
--   transaction_date = 01/05/2026 · tiers 90/180/270 วัน
--     งวด 90 วัน  → ~30/07/2026 (เลยแล้ว)  → Overdue Payment Report
--     งวด 180 วัน → ~28/10/2026 (ยังไม่ถึง) → Due Payment Report
--     งวด 270 วัน → ~26/01/2027 (ยังไม่ถึง) → Due Payment Report
--   ยอดเบิกจริง (chassisSum) = 6,600,000 → ใช้เป็นฐานลดต้นทั้งหน้าจอและรายงาน
--
-- ⚠ ต้อง "เปิด FP แล้วกด Save 1 ครั้ง" (หรือปุ่ม Rebuild Schedules ในหน้า Admin)
--   ก่อน — เพราะตารางงวดกลาง (installment_schedules) ถูกเขียนตอน Save
--   (syncScheduleFor('FP') ทำงานฝั่ง client · SQL เขียน FP ได้ แต่เขียนตารางงวดแทนแอปไม่ได้
--    ต้องให้แอปคำนวณเพื่อให้ตัวเลข "ตรงกับหน้าจอ" แน่นอน)
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-REPORT → กด Save 1 ครั้ง
--   2) แท็บ Schedule Calculate → จดงวด/ดอกเบี้ย/ลดต้น/วันครบกำหนด
--   3) Reports → Due Payment Report (งวด 180/270) · Overdue Payment Report (งวด 90)
--        → ตัวเลขตรงกับแท็บ Schedule Calculate
--
-- รันซ้ำได้ (ลบรถ → FP → CA → MA → curtailment)
-- =====================================================================

delete from fp_chassis where fp_id = 'c4c4c4c4-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-REPORT';
delete from credit_agreements where contract_number = 'CA-DEMO-FP63';
delete from ma_subsidiaries   where ma_id = 'c4c4c4c4-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = 'c4c4c4c4-0000-0000-0000-0000000000a0';
delete from curtailments where vendor = 'BMW (Thailand) Co., Ltd.' and remark = 'seed FP-63 · ตารางลดต้น 3 งวด';

-- ① ตารางลดต้น (Curtailment Master) ของ BMW · 3 งวด 90/180/270 วัน
insert into curtailments
  (vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct, status, remark)
values
  ('BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', null,
   90, 30, 180, 30, 270, 40, 'Active', 'seed FP-63 · ตารางลดต้น 3 งวด');

-- ② MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('c4c4c4c4-0000-0000-0000-0000000000a0', 'KBANK', 'MA-DEMO-FP63', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c4c4c4c4-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ③ CA · ประเภท FP
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('c4c4c4c4-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP63)', 'CA-DEMO-FP63',
   'c4c4c4c4-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ④ Floor Plan · โหมด Curtailment · transaction 01/05/2026 · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, cap_pct, status, rate_cards)
values
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'FP-DEMO-REPORT', 'FP เดโม — ตารางงวดในรายงาน',
   'c4c4c4c4-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', null, 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01',
   8250000, 8250000, 6600000, 'THB', 80, 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb);

-- ⑤ รถ 3 คัน · ครบทุก field · เบิก = 80% ของราคา (รวม 6,600,000)
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, status,
   original_location, current_location, location_modified_at, sold_date, sort_order)
values
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100001', 'B48-100001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 0),
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100002', 'B48-100002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 1),
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100003', 'B48-100003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 2);

-- =====================================================================
-- อย่าลืม: เปิด FP-DEMO-REPORT → กด Save 1 ครั้ง (หรือ Rebuild Schedules)
--          เพื่อให้งวดลดต้นไปโผล่ในรายงาน Due / Overdue Payment
-- =====================================================================
