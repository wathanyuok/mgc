-- =====================================================================
-- Seed: FP-20 — นำเข้าใบสั่งซื้อจาก NetSuite (PO REF)
-- =====================================================================
-- สร้าง Floor Plan สถานะ Draft (ว่าง · แก้ได้) ไว้เปิดแล้วกดนำเข้า PO
--   → vendor / amount / chassis ยังว่าง เพื่อให้เห็นชัดว่าถูกเติมหลังนำเข้า
--
-- ⚠ ไม่ต้อง seed ข้อมูล PO — fetchNetSuitePO เป็น STUB (mock)
--   พิมพ์เลข PO อะไรก็ generate ได้ · เลข curated 2 ตัว:
--     PO-2026-45678 → BMW · 3 คัน · 8,250,000 บาท
--     PO-2026-45679 → BYD · 2 คัน · 2,580,000 บาท
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Floor Plan → FP-DEMO-PO (Draft)
--   2) ช่อง PO REF (NETSUITE) → กดปุ่ม "นำเข้าจาก NetSuite"
--   3) พิมพ์/ใช้ PO-2026-45678 → หน้า "ตรวจข้อมูลก่อนนำเข้า" เด้ง → กด "ยืนยันนำเข้า"
--   4) → VENDOR = BMW · AMOUNT = 8,250,000 · แท็บ Chassis มีรถ 3 คัน
--        · ปุ่มเปลี่ยนเป็น "ดึงใหม่" + ป้าย "นำเข้าแล้ว"
--
-- รันซ้ำได้ (ลบ FP → CA → MA)
-- =====================================================================

delete from fp_chassis where fp_id = 'b0b0b0b0-0000-0000-0000-0000000000f0';
delete from floor_plans where fp_no = 'FP-DEMO-PO';
delete from credit_agreements where contract_number = 'CA-DEMO-FP20';
delete from ma_subsidiaries   where ma_id = 'b0b0b0b0-0000-0000-0000-0000000000a0';
delete from master_agreements where id    = 'b0b0b0b0-0000-0000-0000-0000000000a0';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('b0b0b0b0-0000-0000-0000-0000000000a0', 'KBANK', 'MA-DEMO-FP20', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('b0b0b0b0-0000-0000-0000-0000000000a0', 'MGC', 50000000, 0, 0);

-- ② CA · ประเภท FP
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('b0b0b0b0-0000-0000-0000-0000000000ca', 'CA เดโม — วงเงิน Floor Plan', 'CA-DEMO-FP20',
   'b0b0b0b0-0000-0000-0000-0000000000a0', 'MGC',
   (select id from facility_types where code = 'FP' limit 1),
   20000000, 0, 'THB', 'Revolving', 'KBANK',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ③ Floor Plan (Draft · ว่าง — ยังไม่กรอก vendor/amount/รถ · รอกดนำเข้า)
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, status, rate_cards)
values
  ('b0b0b0b0-0000-0000-0000-0000000000f0', 'FP-DEMO-PO', 'FP เดโม — นำเข้า PO',
   'b0b0b0b0-0000-0000-0000-0000000000ca', 'KBANK', null, 'bmw',
   date '2026-09-01', date '2026-09-01', date '2027-09-01', date '2027-09-01',
   0, 0, 0, 'THB', 'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);
