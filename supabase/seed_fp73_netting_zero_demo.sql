-- =====================================================================
-- Seed: FP-73 — AR-AP Netting · เตือนเมื่อยอด AR/AP เป็น 0 · FIELD ครบทุกช่อง
-- =====================================================================
-- สาย MA → CA → FP (Active) + รถ 3 คัน + Vendor (counterparty) ให้เลือกในหน้า Netting
--   ใช้ทดสอบ: แท็บ AR-AP Netting → New Netting → เลือก Counterparty → ใส่ AR/AP = 0 → บันทึก
--   → เตือน "ยอดลูกหนี้ (AR) ต้องมากกว่า 0"
--
-- ── วิธีทดสอบ (FP-73) ───────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-NETTING → แท็บ AR-AP Netting → New Netting
--   2) เลือก COUNTERPARTY (Customer AND Vendor) = "MGC Dealer Netting (เดโม)"
--   3) ใส่ AR AMOUNT = 0 และ AP AMOUNT = 0 → บันทึก
--   4) ระบบเตือน "ยอดลูกหนี้ (AR) ต้องมากกว่า 0" (ใส่ AR>0 แต่ AP=0 → เตือน AP แทน)
--
-- หมายเหตุ: ไม่ลบ MA/CA (ใช้ upsert) · Vendor ใช้ upsert on code
-- รันซ้ำได้ (ลบเฉพาะ FP + child)
-- =====================================================================

delete from fp_chassis  where fp_id = 'c8c8c8c8-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-NETTING';
delete from curtailments where id   = 'c8c8c8c8-0000-0000-0000-0000000000c7';

-- ① Vendor (Counterparty) · active · ครบทุก field
insert into vendors
  (id, code, name, tax_id, vendor_type, fi_type, netsuite_vendor_id,
   contact_email, contact_phone, address, remark, active,
   created_by, updated_by, created_at, updated_at)
values
  ('c8c8c8c8-0000-0000-0000-000000000073', 'V-NETTING-DEMO', 'MGC Dealer Netting (เดโม)',
   '0105561000073', 'dealer', 'Non-Bank', 'NS-VEND-90001',
   'netting@mgc-demo.co.th', '021234567', '99/1 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120',
   'seed FP-73 · counterparty สำหรับทดสอบ Netting', true,
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (code) do update set
  name = excluded.name, tax_id = excluded.tax_id, vendor_type = excluded.vendor_type,
  fi_type = excluded.fi_type, netsuite_vendor_id = excluded.netsuite_vendor_id,
  contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
  address = excluded.address, remark = excluded.remark, active = true, updated_at = now();

-- ② Curtailment Master · ครบทุก field
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark, created_at, updated_at)
values
  ('c8c8c8c8-0000-0000-0000-0000000000c7',
   'BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', date '2027-12-31',
   90, 30, 180, 30, 270, 40,
   'Active', 'seed FP-73 · ตารางลดต้น 3 งวด', now(), now());

-- ③ MA · ครบทุก field (remaining_credit generated — ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c8c8c8c8-0000-0000-0000-0000000000a0', 'MA-DEMO-FP73', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed FP-73 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'c8c8c8c8-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c8c8c8c8-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ④ CA · FP · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('c8c8c8c8-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP73)', 'CA-DEMO-FP73',
   'c8c8c8c8-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   true, 4, 360,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) — ทดสอบ AR-AP Netting', 'REF-CA-FP73-2026',
   'seed FP-73 · CA วงเงิน Floor Plan', 'ค้ำโดยบริษัทแม่ MGC',
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

-- ⑤ Floor Plan · Active · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, bank_ref, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('c8c8c8c8-0000-0000-0000-0000000000f0', 'FP-DEMO-NETTING', 'FP เดโม — ทดสอบ AR-AP Netting (FP-73)',
   'c8c8c8c8-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-73001', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, 'REF-FP73-2026', null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 Inventory — Floor Plan"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Floor Plan)"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 Cash - Bank"}]'::jsonb,
   'KBANK-FP73-0001', 'Active', 'seed FP-73 · ทดสอบ Netting ยอด 0 · ครบทุก field',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ⑥ รถ 3 คัน · ครบทุก field
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('c8c8c8c8-0000-0000-0000-0000000000f0', 'WBA8E5C50JG500001', 'B48-500001', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c8c8c8c8-0000-0000-0000-0000000000c7', 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c8c8c8c8-0000-0000-0000-0000000000f0', 'WBA8E5C50JG500002', 'B48-500002', 'BMW 320i M Sport',
   date '2026-05-01', 2450000, 1960000, 'c8c8c8c8-0000-0000-0000-0000000000c7', 'In Stock', 1,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('c8c8c8c8-0000-0000-0000-0000000000f0', 'WBA8E5C50JG500003', 'B48-500003', 'BMW 520d',
   date '2026-05-01', 3350000, 2680000, 'c8c8c8c8-0000-0000-0000-0000000000c7', 'In Stock', 2,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- =====================================================================
-- ทดสอบ: FP-DEMO-NETTING → AR-AP Netting → New Netting → เลือก Counterparty
--        "MGC Dealer Netting (เดโม)" → AR=0 · AP=0 → บันทึก
--        → เตือน "ยอดลูกหนี้ (AR) ต้องมากกว่า 0"
-- =====================================================================
