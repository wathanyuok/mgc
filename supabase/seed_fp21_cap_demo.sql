-- =====================================================================
-- Seed: FP-21 — รถนำเข้าติดเพดานต่อคัน · กด Save ได้ทันที
-- =====================================================================
-- จำลองสถานะ "หลังนำเข้า PO-2026-45678 แล้ว" ครบทุก field:
--   FP + รถ 3 คัน · คอลัมน์ "เบิก (Amount)" = 80% ของ "ราคารถ (Snapshot)" ทุกคัน
--   → เปิดแล้วกด Save ได้เลย (ไม่มีคันไหนเกินเพดาน)
--
--   รถ                ราคารถ (Snapshot)   80% Cap = เบิก (Amount)
--   BMW 320i M Sport    2,450,000           1,960,000
--   BMW 320i M Sport    2,450,000           1,960,000
--   BMW 520d            3,350,000           2,680,000
--   รวมเบิก = 6,600,000  ≤  เพดาน Facility (AMOUNT) 8,250,000  ✓
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-CAP → แท็บ Chassis
--        เห็น เบิก (Amount) = 80% Cap ทุกคัน (ไม่ใช่ราคาเต็ม)
--   2) กด Save ทันที → บันทึกสำเร็จ (ไม่ต้องไล่แก้ยอดเบิกทีละคัน)
--
-- รันซ้ำได้ (ลบรถ → FP → CA → MA)
-- =====================================================================

delete from fp_chassis where fp_id = 'c1c1c1c1-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-CAP';
delete from credit_agreements where contract_number = 'CA-DEMO-FP21';
delete from ma_subsidiaries   where ma_id = 'c1c1c1c1-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = 'c1c1c1c1-0000-0000-0000-0000000000a0';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('c1c1c1c1-0000-0000-0000-0000000000a0', 'KBANK', 'MA-DEMO-FP21', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('c1c1c1c1-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ② CA · ประเภท FP
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('c1c1c1c1-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan (FP21)', 'CA-DEMO-FP21',
   'c1c1c1c1-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 0, 'THB', 'Revolving', 'KBANK',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ③ Floor Plan · ครบทุก field (จำลองหลังนำเข้า PO)
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, po_ref, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, cap_pct, status, rate_cards)
values
  ('c1c1c1c1-0000-0000-0000-0000000000f0', 'FP-DEMO-CAP', 'FP เดโม — เพดานต่อคัน',
   'c1c1c1c1-0000-0000-0000-0000000000ca', 'KBANK', 'BMW (Thailand) Co., Ltd.', 'PO-2026-45678', 'bmw',
   date '2026-09-01', date '2026-09-01', date '2027-09-01', date '2027-09-01',
   8250000, 8250000, 0, 'THB', 80, 'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- ④ รถ 3 คัน · ครบทุก field · เบิก (amount) = 80% ของ chassis_price
insert into fp_chassis
  (fp_id, chassis_no, engine_no, model, receive_date,
   chassis_price, amount, status,
   original_location, current_location, location_modified_at, sold_date, sort_order)
values
  ('c1c1c1c1-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100001', 'B48-100001', 'BMW 320i M Sport',
   current_date - 5, 2450000, 1960000, 'In Stock',
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 0),
  ('c1c1c1c1-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100002', 'B48-100002', 'BMW 320i M Sport',
   current_date - 5, 2450000, 1960000, 'In Stock',
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 1),
  ('c1c1c1c1-0000-0000-0000-0000000000f0', 'WBA8E5C50JG100003', 'B48-100003', 'BMW 520d',
   current_date - 5, 3350000, 2680000, 'In Stock',
   'คลัง BMW ลาดกระบัง', 'คลัง BMW ลาดกระบัง', now(), null, 2);
