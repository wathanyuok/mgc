-- =====================================================================
-- Seed: FP-68 — ต่อสัญญา (Roll Over) แล้วรถ/อัตรา/ผังบัญชี ตามไปสัญญาใหม่ · FIELD ครบทุกช่อง
-- =====================================================================
-- สาย MA → CA (ตั้ง rollover limit) → FP (Active, Curtailment 'bmw') + รถ 3 คัน
--   ใช้ทดสอบ: กด 🔁 Roll Over → รถทุกคันย้ายไปสัญญาใหม่ · rate_cards/acct_cards ตามไป
--   · REFERENCE CONTRACT ชี้กลับฉบับเดิม · สัญญาเดิมแท็บ Chassis ว่าง + สถานะ Roll Over
--
-- ── วิธีทดสอบ (FP-68) ───────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-ROLLOVER (Active) → กดปุ่ม 🔁 Roll Over
--   2) หน้าต่าง Roll Over Floor Plan: กรอก NEW FP NUMBER + NEW TERM (DAYS) → Confirm Roll Over
--   3) ระบบพาไปสัญญาใหม่ → แท็บ Chassis (รถครบ) · Interest Rate · Accounting · ช่อง REFERENCE CONTRACT
--   4) เปิดสัญญาเดิม → แท็บ Chassis ว่าง · สถานะ = Roll Over
--
-- หมายเหตุ: ไม่ลบ MA/CA (ใช้ upsert) — กัน FK ON DELETE SET NULL ไปแตะสัญญา HP/Lease
-- รันซ้ำได้ (ลบเฉพาะ FP + child + FP ที่ต่อออกมา)
-- =====================================================================

-- ลบ FP ที่ต่อออกมา (rollover child) ถ้ารันซ้ำ + FP หลัก + child
delete from fp_chassis  where fp_id in (select id from floor_plans where rollover_parent_id = 'c6c6c6c6-0000-0000-0000-0000000000f0');
delete from floor_plans where rollover_parent_id = 'c6c6c6c6-0000-0000-0000-0000000000f0';
delete from fp_chassis  where fp_id = 'c6c6c6c6-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-ROLLOVER';
delete from curtailments where id   = 'c6c6c6c6-0000-0000-0000-0000000000c7';

-- ① ตารางลดต้น (Curtailment Master) · 3 งวด 90/180/270 วัน · ครบทุก field
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark, created_at, updated_at)
values
  ('c6c6c6c6-0000-0000-0000-0000000000c7',
   'BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', date '2027-12-31',
   90, 30, 180, 30, 270, 40,
   'Active', 'seed FP-68 · ตารางลดต้น 3 งวด', now(), now());

-- ② MA · ครบทุก field (remaining_credit generated — ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c6c6c6c6-0000-0000-0000-0000000000a0', 'MA-DEMO-FP68', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed FP-68 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'c6c6c6c6-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c6c6c6c6-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ③ CA · FP · ตั้ง rollover_max_times/days ให้ต่อสัญญาได้ · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('c6c6c6c6-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP68)', 'CA-DEMO-FP68',
   'c6c6c6c6-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   true, 4, 1080,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) — รองรับ Roll Over', 'REF-CA-FP68-2026',
   'seed FP-68 · CA วงเงิน Floor Plan (Roll Over)', 'ค้ำโดยบริษัทแม่ MGC',
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
  facility_type_id = excluded.facility_type_id,
  credit_line = excluded.credit_line,
  utilization = excluded.utilization, currency = excluded.currency,
  credit_type = excluded.credit_type, finance_institution = excluded.finance_institution,
  curtailment_option = excluded.curtailment_option, rollover_max_times = excluded.rollover_max_times,
  rollover_max_days = excluded.rollover_max_days, loan_purpose = excluded.loan_purpose,
  reference_contract = excluded.reference_contract, remark = excluded.remark,
  guarantee_remark = excluded.guarantee_remark,
  rate_cards = excluded.rate_cards, acct_cards = excluded.acct_cards,
  start_date = excluded.start_date, end_date = excluded.end_date,
  status = excluded.status, updated_at = now();

-- ④ Floor Plan · Active · โหมด Curtailment ('bmw') · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, bank_ref, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c6c6c6c6-0000-0000-0000-0000000000f0', 'FP-DEMO-ROLLOVER', 'FP เดโม — ต่อสัญญา (FP-68)',
   'c6c6c6c6-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-68001', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, null, null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   'KBANK-FP68-0001', 'Active', 'seed FP-68 · ทดสอบ Roll Over ให้รถ/อัตรา/ผังบัญชีตามไป · ครบทุก field',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ⑤ รถ 3 คัน · ครบทุก field · เบิก = 80% (รวม 6,600,000) — ใช้ทดสอบว่าย้ายครบตอน Roll Over
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('c6c6c6c6-0000-0000-0000-0000000000f0', 'WBA8E5C50JG300001', 'B48-300001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c6c6c6c6-0000-0000-0000-0000000000c7', 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c6c6c6c6-0000-0000-0000-0000000000f0', 'WBA8E5C50JG300002', 'B48-300002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c6c6c6c6-0000-0000-0000-0000000000c7', 'In Stock', 1,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c6c6c6c6-0000-0000-0000-0000000000f0', 'WBA8E5C50JG300003', 'B48-300003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, 'c6c6c6c6-0000-0000-0000-0000000000c7', 'In Stock', 2,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- =====================================================================
-- ทดสอบ: เปิด FP-DEMO-ROLLOVER → 🔁 Roll Over → กรอก NEW FP NUMBER + NEW TERM (DAYS)
--        → Confirm Roll Over → รถ 3 คันย้ายไปสัญญาใหม่ · REFERENCE CONTRACT ชี้กลับ
--        · สัญญาเดิมสถานะ Roll Over แท็บ Chassis ว่าง
-- =====================================================================
