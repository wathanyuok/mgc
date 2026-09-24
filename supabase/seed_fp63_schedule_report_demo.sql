-- =====================================================================
-- Seed: FP-63 — ตารางงวด (ลดต้น) ในรายงานกลาง (Due / Overdue)  · FIELD ครบทุกช่อง
-- =====================================================================
-- สาย MA → CA → FP (โหมด Curtailment 'bmw') + ตารางลดต้น 3 งวด + รถ 3 คัน
-- ตั้งวันให้ milestone คร่อมวันนี้ (24/09/2026) → ได้ทั้ง Due และ Overdue:
--   transaction_date = 01/05/2026 · tiers 90/180/270 วัน
--     งวด 90 วัน  → ~30/07/2026 (เลยแล้ว)  → Overdue Payment Report
--     งวด 180 วัน → ~28/10/2026 (ยังไม่ถึง) → Due Payment Report
--     งวด 270 วัน → ~26/01/2027 (ยังไม่ถึง) → Due Payment Report
--   ยอดเบิกจริง (chassisSum) = 6,600,000 → ฐานลดต้นทั้งหน้าจอและรายงาน
--
-- ⚠ ต้อง "เปิด FP-DEMO-REPORT แล้วกด Save 1 ครั้ง" (หรือ Rebuild Schedules)
--   ก่อน — เพราะตารางงวดกลาง (installment_schedules) ถูกเขียนตอน Save
--   (syncScheduleFor('FP') ทำงานฝั่ง client · SQL เขียน FP + child ได้ครบ
--    แต่ตารางงวดกลางต้องให้แอปคำนวณเพื่อให้ตัวเลข "ตรงกับหน้าจอ" แน่นอน)
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-REPORT → กด Save 1 ครั้ง
--   2) แท็บ Schedule Calculate → จดงวด/ดอกเบี้ย/ลดต้น/วันครบกำหนด
--   3) Reports → Due Payment Report (งวด 180/270) · Overdue Payment Report (งวด 90)
--        → ตัวเลขคอลัมน์ Due Payment Date · Curtailment / Balloon · Interest / Fee
--          ตรงกับแท็บ Schedule Calculate
--
-- รันซ้ำได้ (ลบรถ → FP → CA → MA → curtailment)
-- =====================================================================

-- ลบเฉพาะ FP + child (ปลอดภัย) · MA/CA ใช้ upsert แทนการลบ
-- (ห้าม delete CA — ถ้ามีสัญญา HP/Lease ผูกอยู่ FK ON DELETE SET NULL จะทำให้
--  ca_id เป็น null แล้วชน check constraint "HP ต้องมี CA")
delete from fp_chassis  where fp_id = 'c4c4c4c4-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-REPORT';
delete from curtailments where id   = 'c4c4c4c4-0000-0000-0000-0000000000c7';

-- ① ตารางลดต้น (Curtailment Master) ของ BMW · 3 งวด 90/180/270 วัน · ครบทุก field
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark, created_at, updated_at)
values
  ('c4c4c4c4-0000-0000-0000-0000000000c7',
   'BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', date '2027-12-31',
   90, 30, 180, 30, 270, 40,
   'Active', 'seed FP-63 · ตารางลดต้น 3 งวด (90/180/270)', now(), now());

-- ② MA · ครบทุก field
-- หมายเหตุ: remaining_credit เป็น generated column (credit_line - utilization) — ห้าม insert
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c4c4c4c4-0000-0000-0000-0000000000a0', 'MA-DEMO-FP63', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed FP-63 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'c4c4c4c4-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c4c4c4c4-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ③ CA · ประเภท FP · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('c4c4c4c4-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP63)', 'CA-DEMO-FP63',
   'c4c4c4c4-0000-0000-0000-0000000000a0', 'MGC', 'FP',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   true, 4, 360,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) สำหรับดีลเลอร์ BMW', 'REF-CA-FP63-2026',
   'seed FP-63 · CA วงเงิน Floor Plan', 'ค้ำโดยบริษัทแม่ MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   date '2026-01-01', date '2027-12-31', 'Approved',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ca_name = excluded.ca_name, contract_number = excluded.contract_number,
  ma_id = excluded.ma_id, subsidiary = excluded.subsidiary,
  facility_type = excluded.facility_type, facility_type_id = excluded.facility_type_id,
  credit_line = excluded.credit_line,
  utilization = excluded.utilization, currency = excluded.currency,
  credit_type = excluded.credit_type, finance_institution = excluded.finance_institution,
  curtailment_option = excluded.curtailment_option, rollover_max_times = excluded.rollover_max_times,
  rollover_max_days = excluded.rollover_max_days, loan_purpose = excluded.loan_purpose,
  reference_contract = excluded.reference_contract, remark = excluded.remark,
  guarantee_remark = excluded.guarantee_remark,
  rate_cards = excluded.rate_cards, acct_cards = excluded.acct_cards,
  start_date = excluded.start_date,
  end_date = excluded.end_date, status = excluded.status, updated_at = now();

-- ④ Floor Plan · โหมด Curtailment ('bmw') · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, bank_ref, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'FP-DEMO-REPORT', 'FP เดโม — ตารางงวดในรายงาน (FP-63)',
   'c4c4c4c4-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-63001', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, 'REF-FP63-2026', null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   'KBANK-FP63-0001', 'Active', 'seed FP-63 · ตารางลดต้นในรายงาน Due/Overdue · ครบทุก field',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ⑤ รถ 3 คัน · ครบทุก field · เบิก = 80% ของราคา (รวม 6,600,000)
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100001', 'B48-100001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c4c4c4c4-0000-0000-0000-0000000000c7', 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100002', 'B48-100002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c4c4c4c4-0000-0000-0000-0000000000c7', 'In Stock', 1,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c4c4c4c4-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100003', 'B48-100003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, 'c4c4c4c4-0000-0000-0000-0000000000c7', 'In Stock', 2,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- =====================================================================
-- อย่าลืม: เปิด FP-DEMO-REPORT → กด Save 1 ครั้ง (หรือ Rebuild Schedules)
--          เพื่อให้งวดลดต้นไปโผล่ในรายงาน Due / Overdue Payment
-- =====================================================================
