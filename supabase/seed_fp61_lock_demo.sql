-- =====================================================================
-- Seed: FP-61 — ล็อกปุ่มสลับโหมดตารางเมื่อลงบัญชีแล้ว
-- =====================================================================
-- สาย MA → CA → FP (Active · Fixed 5%) + รถ 3 คัน + ใบสำคัญ FP_DRAWDOWN (Posted)
-- มี JE Posted → ปุ่ม "Curtailment Schedule" / "No Curtailment" ถูกล็อก (กดไม่ได้)
--
--   รถ 3 คัน · เบิก = 80% cap · รวมเบิก 6,600,000 (= ยอด JE Drawdown)
--   FP amount (เพดาน) = 8,250,000
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-LOCK → แท็บ Schedule Calculate
--   2) ลองกดปุ่มสลับโหมด "Curtailment Schedule" ↔ "No Curtailment"
--        → ปุ่มจาง กดไม่ได้ · ชี้ขึ้น "ห้ามเปลี่ยนโหมด — มี JE Posted แล้ว
--          (Reverse JE ก่อนถ้าต้องเปลี่ยน)"
--   3) กด "↩ กลับรายการวันเบิกเงิน" → JE ถูก Reverse → ปุ่มสลับโหมดกดได้อีกครั้ง
--
-- รันซ้ำได้ (ลบ JE → รถ → FP → CA → MA)
-- =====================================================================

delete from je_lines where je_id = 'c2c2c2c2-0000-0000-0000-0000000000e1';
delete from journal_entries where id = 'c2c2c2c2-0000-0000-0000-0000000000e1';
delete from fp_chassis where fp_id = 'c2c2c2c2-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-LOCK';
delete from credit_agreements where contract_number = 'CA-DEMO-FP61';
delete from ma_subsidiaries   where ma_id = 'c2c2c2c2-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = 'c2c2c2c2-0000-0000-0000-0000000000a0';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('c2c2c2c2-0000-0000-0000-0000000000a0', 'KBANK', 'MA-DEMO-FP61', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c2c2c2c2-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ② CA · ประเภท FP
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('c2c2c2c2-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP61)', 'CA-DEMO-FP61',
   'c2c2c2c2-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 6600000, 'THB', 'Revolving', 'KBANK',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ③ Floor Plan (Active · Fixed 5% · โหมด Curtailment Schedule) · ครบทุก field
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, cap_pct, status, rate_cards)
values
  ('c2c2c2c2-0000-0000-0000-0000000000f0', 'FP-DEMO-LOCK', 'FP เดโม — ล็อกโหมดหลังลงบัญชี',
   'c2c2c2c2-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', null, 'bmw',
   date '2026-09-01', date '2026-09-01', date '2027-09-01', date '2027-09-01',
   8250000, 8250000, 6600000, 'THB', 80, 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb);

-- ④ รถ 3 คัน · ครบทุก field · เบิก = 80% ของราคา
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, status,
   original_location, current_location, location_modified_at, sold_date, sort_order)
values
  ('c2c2c2c2-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100001', 'B48-100001', 'BMW 320i M Sport',
   current_date - 5, 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 0),
  ('c2c2c2c2-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100002', 'B48-100002', 'BMW 320i M Sport',
   current_date - 5, 2450000, 1960000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 1),
  ('c2c2c2c2-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100003', 'B48-100003', 'BMW 520d',
   current_date - 5, 3350000, 2680000, 'In Stock', 'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 2);

-- ⑤ ใบสำคัญวันเบิกเงิน (FP_DRAWDOWN · Posted) → ทำให้ปุ่มสลับโหมดถูกล็อก
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
values
  ('c2c2c2c2-0000-0000-0000-0000000000e1', 'JE-DEMO-FP61', 'FP_DRAWDOWN',
   'c2c2c2c2-0000-0000-0000-0000000000f0', 0, current_date, 'Sep 2026',
   'FP-DEMO-LOCK — Floor Plan Drawdown', 6600000, 6600000, 'Posted', 'system', now(), false,
   'Vendor: BMW (Thailand) Co., Ltd. · 3 คัน');

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('c2c2c2c2-0000-0000-0000-0000000000e1', 1, '1151101', 'Inventory — Floor Plan', 6600000, 0, 'Inventory at cost'),
  ('c2c2c2c2-0000-0000-0000-0000000000e1', 2, '2142101', 'AP — Floor Plan (Bank)', 0, 6600000, 'Note Payable — Floor Plan drawdown');
