-- =====================================================================
-- Seed: FP-79 — ปรับปรุงยอดให้ตรงกับใบแจ้งยอดธนาคาร (แท็บ Reconcile) · FIELD ครบทุกช่อง
-- =====================================================================
-- สาย MA → CA → FP (โหมด Curtailment 'bmw') + ตารางลดต้น 90/180/270 + รถ 2 คัน
-- ลงบัญชีวันเบิกเงิน (FP_DRAWDOWN, Posted) ไว้แล้ว → สัญญา Active มีผลจริง
-- งวด milestone มีทั้ง "เงินต้น (ลดต้น)" + "ดอกเบี้ย" → แท็บ Reconcile กด "Adjust" ได้
--
-- ⚠ เปิด FP-DEMO-RECON → กด Save 1 ครั้ง ก่อน (ตารางงวดกลาง installment_schedules
--   ถูกเขียนตอน Save · syncScheduleFor('FP') ฝั่ง client)
--
-- ── วิธีทดสอบ (แท็บ Reconcile) ─────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-RECON → กด Save 1 ครั้ง
--   2) แท็บ "Reconcile" → งวด milestone → กด "Adjust"
--   3) แก้ "เงินต้น (ใหม่)" → "ดอกเบี้ย (ใหม่)" ปรับให้เอง (Total Due คงเดิม ✓)
--   4) เลือก Reason → "Post Adjustment" → แถวขึ้นป้าย "Adjusted"
--      JE ปรับปรุงลงรหัสจริง COA: ดอกเบี้ยรับ 4931107 · เงินให้กู้ยืม 1141106
--
-- รันซ้ำได้ (ลบ JE → รถ → FP → CA(upsert) → MA(upsert) → curtailment)
-- =====================================================================

-- ── ลบของเดิม (JE + รถ + FP) · MA/CA ใช้ upsert ไม่ลบ (กัน FK ชน) ──
-- ลบครอบทั้ง je_number / fp_no / id เก่า+ใหม่ (กันชนจากรอบก่อนที่เคยใช้ id คนละตัว)
delete from je_lines
 where je_id in (select id from journal_entries
                 where je_number = 'JE-DEMO-RECON'
                    or source_id in (select id from floor_plans where fp_no = 'FP-DEMO-RECON')
                    or id in ('d9d90000-0000-0000-0000-0000000000e0',
                              '22222222-2222-2222-2222-2222222d9179'));
delete from journal_entries
 where je_number = 'JE-DEMO-RECON'
    or source_id in (select id from floor_plans where fp_no = 'FP-DEMO-RECON')
    or id in ('d9d90000-0000-0000-0000-0000000000e0',
              '22222222-2222-2222-2222-2222222d9179');
delete from fp_chassis
 where fp_id in (select id from floor_plans where fp_no = 'FP-DEMO-RECON')
    or fp_id in ('d9d90000-0000-0000-0000-0000000000f0',
                 '11111111-1111-1111-1111-1111111d9179');
delete from floor_plans
 where fp_no = 'FP-DEMO-RECON'
    or id in ('d9d90000-0000-0000-0000-0000000000f0',
              '11111111-1111-1111-1111-1111111d9179');
delete from curtailments where id = 'd9d90000-0000-0000-0000-0000000000c7';
-- ล้าง bank statement + bank lines ที่ match FP นี้ (re-runnable)
delete from bank_statement_lines
 where facility_id = 'd9d90000-0000-0000-0000-0000000000f0'
    or statement_id = 'd9d90000-0000-0000-0000-0000000000b0';
delete from bank_statements where id = 'd9d90000-0000-0000-0000-0000000000b0';

-- ① ตารางลดต้น (Curtailment Master) · 3 งวด 90/180/270 · ครบทุก field
insert into curtailments
  (id, vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
   status, remark, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000c7',
   'BMW (Thailand) Co., Ltd.', 'New', date '2026-01-01', date '2027-12-31',
   90, 30, 180, 30, 270, 40,
   'Active', 'seed FP-79 · ตารางลดต้น 3 งวด (90/180/270)', now(), now());

-- ② MA · ครบทุก field (remaining_credit เป็น generated column — ห้าม insert)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status,
   start_date, end_date, credit_line, utilization,
   guarantee_remark, inactive, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000a0', 'MA-DEMO-FP79', 'KBANK', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 6600000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed FP-79 · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set
  ma_name = excluded.ma_name, finance_institution = excluded.finance_institution,
  subsidiary = excluded.subsidiary, status = excluded.status,
  start_date = excluded.start_date, end_date = excluded.end_date,
  credit_line = excluded.credit_line, utilization = excluded.utilization,
  guarantee_remark = excluded.guarantee_remark, inactive = excluded.inactive,
  remark = excluded.remark, updated_at = now();

delete from ma_subsidiaries where ma_id = 'd9d90000-0000-0000-0000-0000000000a0';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('d9d90000-0000-0000-0000-0000000000a0', 'MGC', 50000000, 6600000, 0);

-- ③ CA · ประเภท FP · ครบทุก field
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark,
   rate_cards, acct_cards,
   start_date, end_date, status,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP79)', 'CA-DEMO-FP79',
   'd9d90000-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   true, 4, 360,
   'วงเงินสินเชื่อสต๊อกรถ (Floor Plan) สำหรับดีลเลอร์ BMW', 'REF-CA-FP79-2026',
   'seed FP-79 · CA วงเงิน Floor Plan', 'ค้ำโดยบริษัทแม่ MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
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
  start_date = excluded.start_date,
  end_date = excluded.end_date, status = excluded.status, updated_at = now();

-- ④ Floor Plan · โหมด Curtailment ('bmw') · Active · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, bank_ref, schedule_mode,
   start_date, transaction_date, maturity_date, end_date, term_days,
   total_amount, used_amount, amount, cap_pct, currency,
   netting_ap, netting_ar, reference_contract, rollover_parent_id, inactive,
   rate_cards, acct_cards, status, remark,
   created_by, updated_by, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000f0', 'FP-DEMO-RECON', 'FP เดโม — ปรับปรุงยอด Reconcile (FP-79)',
   'd9d90000-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-79001', 'KBANK-FP79-0001', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01', 365,
   8250000, 6600000, 8250000, 80, 'THB',
   true, true, 'REF-FP79-2026', null, false,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},
     {"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512112 ดอกเบี้ยจ่าย-Floor Plan"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},
     {"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   'Active', 'seed FP-79 · ทดสอบแท็บ Reconcile · ครบทุก field',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now());

-- ⑤ รถ 2 คัน · ครบทุก field · เบิก = 80% ของราคา (รวม 6,600,000)
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, curtail_id, status, sort_order,
   original_location, current_location, location_modified_at, sold_date, sold_source)
values
  ('d9d90000-0000-0000-0000-0000000000f0', 'WBA8E5C50JG790001', 'B48-790001', 'BMW 320i M Sport',
   date '2026-05-01', 4125000, 3300000, 'd9d90000-0000-0000-0000-0000000000c7', 'In Stock', 0,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual'),
  ('d9d90000-0000-0000-0000-0000000000f0', 'WBA8E5C50JG790002', 'B48-790002', 'BMW 520d',
   date '2026-05-01', 4125000, 3300000, 'd9d90000-0000-0000-0000-0000000000c7', 'In Stock', 1,
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', date '2026-05-01', null, 'manual');

-- ⑥ ใบสำคัญวันเบิกเงิน (FP_DRAWDOWN, Posted) · ครบทุก field (รวม netsuite sync)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at,
   reversed_by_je_id, is_reversal, remark,
   netsuite_je_id, netsuite_synced_at, sync_status, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000e0', 'JE-DEMO-RECON', 'FP_DRAWDOWN',
   'd9d90000-0000-0000-0000-0000000000f0', null, date '2026-05-01', 'May 2026',
   'FP-DEMO-RECON — Floor Plan Drawdown', 6600000, 6600000, 'Posted',
   'seed', now(), null, false, 'seed FP-79 · ใบเบิกเงิน สำหรับทดสอบแท็บ Reconcile',
   null, null, 'pending', now(), now());

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('d9d90000-0000-0000-0000-0000000000e0', 1, '1151101', 'สินค้าคงเหลือ-ยานพาหนะ', 6600000, 0, 'Inventory at cost — Floor Plan drawdown'),
  ('d9d90000-0000-0000-0000-0000000000e0', 2, '2142101', 'เงินกู้ยืมระยะสั้น-สถาบันการเงิน', 0, 6600000, 'Note Payable — Floor Plan drawdown');

-- ⑦ ใบแจ้งยอดธนาคาร (Bank Statement) · ครบทุก field
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period,
   source, inactive, remark, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-0000000000b0', 'KBANK', '181-3-11063-0',
   'KBANK — Floor Plan Reconcile (FP-79)', '2026-07', 'Manual', false,
   'seed FP-79 · ใบแจ้งยอดสำหรับทดสอบ Reconcile', now(), now());

-- ⑧ รายการเดินบัญชี match กับ FP-DEMO-RECON งวด curtailment (3 / 7 / 11) · ครบทุก field
--   งวดที่มีทั้งเงินต้น+ดอกเบี้ย → แท็บ Reconcile จะมีปุ่ม "Adjust" ที่งวดเหล่านี้
--   facility_type='FP' · facility_type_id=(FP) · facility_id=FP นี้ · source_period=เลขงวด
-- งวดที่มี "เงินต้น (ลดต้น)" จริงตามตาราง = งวด 2 / 4 / 7 · ยอด bank = Total Due ของงวดนั้น
--   (ยอดตรงกับตาราง → diff = 0 → state Bank Confirmed · กด Adjust แก้สัดส่วนเงินต้น/ดอกเบี้ยได้)
insert into bank_statement_lines
  (statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance,
   source, remark, sort_order,
   facility_type_id, facility_id, source_period)
values
  ('d9d90000-0000-0000-0000-0000000000b0', date '2026-06-30', '10:15', 'TRANSFER',
   'ธนาคารตัดชำระ Floor Plan งวด 2 (ลดต้น + ดอกเบี้ย)', 1017123.29, 0, -1017123.29,
   'Manual', 'match FP-DEMO-RECON งวด 2', 0,
   (select id from facility_types where code = 'FP' limit 1),
   'd9d90000-0000-0000-0000-0000000000f0', 2),
  ('d9d90000-0000-0000-0000-0000000000b0', date '2026-08-29', '10:20', 'TRANSFER',
   'ธนาคารตัดชำระ Floor Plan งวด 4 (ลดต้น + ดอกเบี้ย)', 2002286.30, 0, -3019409.59,
   'Manual', 'match FP-DEMO-RECON งวด 4', 1,
   (select id from facility_types where code = 'FP' limit 1),
   'd9d90000-0000-0000-0000-0000000000f0', 4),
  ('d9d90000-0000-0000-0000-0000000000b0', date '2026-10-28', '10:25', 'TRANSFER',
   'ธนาคารตัดชำระ Floor Plan งวด 7 (ลดต้น + ดอกเบี้ย)', 3313923.29, 0, -6333332.88,
   'Manual', 'match FP-DEMO-RECON งวด 7', 2,
   (select id from facility_types where code = 'FP' limit 1),
   'd9d90000-0000-0000-0000-0000000000f0', 7);

-- =====================================================================
-- อย่าลืม: เปิด FP-DEMO-RECON → กด Save 1 ครั้ง (สร้างตารางงวดกลาง)
--          แล้วไปแท็บ "Reconcile" → งวด 2 / 4 / 7 จะมีปุ่ม "Adjust" (งวดที่มีเงินต้น+ดอกเบี้ย)
-- หมายเหตุ: ยอด bank line = Total Due ของแต่ละงวดตามตาราง (diff = 0 → Bank Confirmed ไม่ใช่ overcut)
--          กด Adjust เพื่อแก้สัดส่วน เงินต้น/ดอกเบี้ย (ยอดรวมคงเดิม) → หลังบันทึกปุ่มเป็น "Re-adjust"
--          ถ้าอยากจำลอง overcut: ตั้ง bank debit ให้มากกว่า Total Due ของงวดนั้น
-- =====================================================================
