-- =====================================================================
-- Seed: AR-AP Netting — แบบกดเองตั้งแต่ต้น (New → Draft → Approved → Execute) · FIELD ครบทุกช่อง
-- =====================================================================
-- เตรียมแค่ FP (Active) + Vendor (counterparty) ไว้ · ไม่มี netting record มาให้
--   → ผู้ทดสอบสร้าง Netting เองครบทุก step
--
-- ── วิธีทดสอบ (กดเองตั้งแต่ 1) ────────────────────────────────────────
--   เปิด Floor Plan → FP-DEMO-NETTING3 → แท็บ AR-AP Netting
--   1) กด New Netting → เลือก Counterparty "Toyota Leasing (Thailand)"
--        · AR AMOUNT 300,000 · AP AMOUNT 500,000 → Save → แถวสถานะ Draft
--   2) กด Edit แถวนั้น → เปลี่ยน STATUS เป็น Approved → Save
--   3) คอลัมน์ ACTION → กด Execute → ยืนยัน
--   4) ระบบลง JE + Post → สถานะ Executed · คอลัมน์ JE มีเลขใบสำคัญ
--      (NET = |300k−500k| = 200,000 · จ่ายสุทธิ)
--
-- หมายเหตุ: ไม่ลบ MA/CA (upsert) · Vendor upsert on code · รันซ้ำได้
-- =====================================================================

delete from ar_ap_nettings where fp_id = 'cacacaca-0000-0000-0000-0000000000f0';
delete from fp_chassis  where fp_id = 'cacacaca-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-NETTING3';
delete from curtailments where id   = 'cacacaca-0000-0000-0000-0000000000c7';

-- ① Vendor (Counterparty) · active · ครบทุก field
insert into vendors
  (id, code, name, tax_id, vendor_type, fi_type, netsuite_vendor_id,
   contact_email, contact_phone, address, remark, active,
   created_by, updated_by, created_at, updated_at)
values
  ('cacacaca-0000-0000-0000-000000000074', 'V-NETTING-TOYOTA', 'Toyota Leasing (Thailand) Co., Ltd.',
   '0105539000174', 'lessor', 'Non-Bank', 'NS-VEND-90002',
   'ap@toyotaleasing-demo.co.th', '021112222', '99 อาคารทาวเวอร์ ถนนวิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900',
   'seed Netting manual · counterparty (customer AND vendor)', true,
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (code) do update set
  name = excluded.name, tax_id = excluded.tax_id, vendor_type = excluded.vendor_type,
  fi_type = excluded.fi_type, netsuite_vendor_id = excluded.netsuite_vendor_id,
  contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
  address = excluded.address, remark = excluded.remark, active = true, updated_at = now();

-- ② Curtailment Master
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark, created_at, updated_at)
values
  ('cacacaca-0000-0000-0000-0000000000c7',
   'BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', date '2027-12-31',
   90, 30, 180, 30, 270, 40, 'Active', 'seed Netting manual · ตารางลดต้น', now(), now());

-- ③ MA
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('cacacaca-0000-0000-0000-0000000000a0', 'MA-DEMO-NETTING3', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed Netting manual · MA',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'cacacaca-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('cacacaca-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ④ CA
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('cacacaca-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (Netting3)', 'CA-DEMO-NETTING3',
   'cacacaca-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   true, 4, 360,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) — ทดสอบ AR-AP Netting (manual)', 'REF-CA-NETTING3-2026',
   'seed Netting manual · CA', 'ค้ำโดยบริษัทแม่ MGC',
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
  facility_type_id = excluded.facility_type_id, credit_line = excluded.credit_line,
  utilization = excluded.utilization, currency = excluded.currency,
  credit_type = excluded.credit_type, finance_institution = excluded.finance_institution,
  curtailment_option = excluded.curtailment_option, rollover_max_times = excluded.rollover_max_times,
  rollover_max_days = excluded.rollover_max_days, loan_purpose = excluded.loan_purpose,
  reference_contract = excluded.reference_contract, remark = excluded.remark,
  guarantee_remark = excluded.guarantee_remark,
  rate_cards = excluded.rate_cards, acct_cards = excluded.acct_cards,
  start_date = excluded.start_date, end_date = excluded.end_date,
  status = excluded.status, updated_at = now();

-- ⑤ Floor Plan · Active (KBANK)
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, bank_ref, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('cacacaca-0000-0000-0000-0000000000f0', 'FP-DEMO-NETTING3', 'FP เดโม — Netting (กดเองตั้งแต่ต้น)',
   'cacacaca-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-75001', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, 'REF-NETTING3-2026', null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   'KBANK-NETTING3-0001', 'Active', 'seed Netting manual · FP สำหรับกด New Netting เอง',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ⑥ รถ 1 คัน (ให้ FP มีของ)
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('cacacaca-0000-0000-0000-0000000000f0', 'WBA8E5C50JG700001', 'B48-700001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'cacacaca-0000-0000-0000-0000000000c7', 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- =====================================================================
-- ไม่มี Netting record มาให้ — สร้างเองทั้งหมด: New Netting → Draft → Approved → Execute
-- Counterparty ที่ seed ไว้: "Toyota Leasing (Thailand) Co., Ltd."
-- =====================================================================
