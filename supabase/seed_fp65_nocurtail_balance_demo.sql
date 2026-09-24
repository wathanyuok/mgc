-- =====================================================================
-- Seed: FP-65 — โหมด No Curtailment · Balance Summary ขยับเมื่อตัดชำระ  · FIELD ครบทุกช่อง
-- =====================================================================
-- สาย MA → CA → FP (schedule_mode = 'other' = No Curtailment) + รถ 3 คัน
--   No Curtailment = รับรู้ดอกเบี้ยรายเดือนถึง Maturity · ไม่มีการทยอยคืนต้น
--   เงินต้นตัดผ่านเมนู Repayment ทั้งก้อน → Balance Summary อ่านยอดจาก repayment_lines (Posted)
--   ยอดเบิกจริง (chassisSum) = 6,600,000
--
-- ── วิธีทดสอบ (FP-65) ───────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-NOCURTAIL → แท็บ Schedule Calculate ต้องเป็นโหมด No Curtailment
--   2) แท็บ Balance Summary → จดยอดที่ชำระแล้ว (ตอนนี้ = 0)
--   3) เมนู Repayment → สร้างรายการตัดชำระของสัญญานี้ แล้วกด Post (สถานะ Posted)
--   4) กลับมาแท็บ Balance Summary → ยอดที่ชำระแล้วต้องขยับตามที่ตัด (เฉพาะรายการ Posted)
--
-- หมายเหตุ: ไม่ลบ MA/CA (ใช้ upsert) — กัน FK ON DELETE SET NULL ไปแตะสัญญา HP/Lease
-- รันซ้ำได้ (ลบเฉพาะ FP + child)
-- =====================================================================

delete from fp_chassis  where fp_id = 'c5c5c5c5-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-NOCURTAIL';

-- ① MA · ครบทุก field (remaining_credit เป็น generated — ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c5c5c5c5-0000-0000-0000-0000000000a0', 'MA-DEMO-FP65', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed FP-65 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'c5c5c5c5-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c5c5c5c5-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ② CA · ประเภท FP · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('c5c5c5c5-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP65)', 'CA-DEMO-FP65',
   'c5c5c5c5-0000-0000-0000-0000000000a0', 'MGC', 'FP',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   false, 4, 360,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) โหมดไม่มีการลดต้น', 'REF-CA-FP65-2026',
   'seed FP-65 · CA วงเงิน Floor Plan (No Curtailment)', 'ค้ำโดยบริษัทแม่ MGC',
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

-- ③ Floor Plan · โหมด No Curtailment ('other') · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, bank_ref, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c5c5c5c5-0000-0000-0000-0000000000f0', 'FP-DEMO-NOCURTAIL', 'FP เดโม — โหมดไม่มีการลดต้น (FP-65)',
   'c5c5c5c5-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-65001', 'other',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, 'REF-FP65-2026', null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   'KBANK-FP65-0001', 'Active', 'seed FP-65 · โหมด No Curtailment · ตัดต้นผ่าน Repayment · ครบทุก field',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ④ รถ 3 คัน · ครบทุก field · No Curtailment → curtail_id = null · เบิก = 80% (รวม 6,600,000)
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('c5c5c5c5-0000-0000-0000-0000000000f0', 'WBA8E5C50JG200001', 'B48-200001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, null, 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c5c5c5c5-0000-0000-0000-0000000000f0', 'WBA8E5C50JG200002', 'B48-200002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, null, 'In Stock', 1,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c5c5c5c5-0000-0000-0000-0000000000f0', 'WBA8E5C50JG200003', 'B48-200003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, null, 'In Stock', 2,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- =====================================================================
-- ทดสอบ: เปิด FP-DEMO-NOCURTAIL → Balance Summary (ยอดชำระ = 0)
--        → เมนู Repayment ตัดชำระ + Post → กลับมา Balance Summary ยอดต้องขยับ
-- =====================================================================
