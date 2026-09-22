-- =====================================================================
-- Seed: TR-13 (FR-TR-001 / UC-TR-001) — เปลี่ยนวงเงินหลังแก้อัตราเอง
-- =====================================================================
-- สร้างวงเงิน (CA) 2 ตัวที่มีอัตราดอกเบี้ยต่างกัน ไว้เลือกในหน้า Trust Receipt:
--   • CA-TR13-A (วงเงิน ก) — อัตรา 5%
--   • CA-TR13-B (วงเงิน ข) — อัตรา 7%
-- ทั้งคู่ Approved จึงโผล่ในช่อง CREDIT AGREEMENT ของ TR
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) สร้าง Trust Receipt ใหม่ → เลือกวงเงิน "ก" (CA-TR13-A)
--        → แท็บ Interest Rate จะดึงอัตรา 5% มาให้ (เพราะตอนนั้นยังว่าง)
--   2) แก้อัตราเองในแท็บ Interest Rate เป็นค่าอื่น (เช่น 9%)
--   3) เปลี่ยนช่องวงเงินเป็น "ข" (CA-TR13-B, อัตราจริง 7%)
--        → ผลที่คาดหวัง: อัตรา 9% ที่แก้เอง "ยังอยู่" — ระบบไม่ทับด้วย 7% ของวงเงิน ข
--          (ดึงให้เฉพาะตอนช่องอัตรายังว่างเท่านั้น)
--
-- รันซ้ำได้ (ลบของเดิมก่อน)
-- =====================================================================

delete from credit_agreements where contract_number in ('CA-TR13-A', 'CA-TR13-B');

-- วงเงิน ก — อัตรา 5%
insert into credit_agreements
  (ca_name, contract_number, subsidiary, facility_type_id, credit_line, utilization, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards)
values
  ('CA-TR13-A · วงเงิน ก (อัตรา 5%)', 'CA-TR13-A', 'MCR',
   (select id from facility_types where code = 'TR' limit 1),
   5000000, 0, 'THB', 'Revolving', 'BBL',
   current_date - 30, current_date + 335, 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-01-01"}]'::jsonb);

-- วงเงิน ข — อัตรา 7%
insert into credit_agreements
  (ca_name, contract_number, subsidiary, facility_type_id, credit_line, utilization, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards)
values
  ('CA-TR13-B · วงเงิน ข (อัตรา 7%)', 'CA-TR13-B', 'MCR',
   (select id from facility_types where code = 'TR' limit 1),
   5000000, 0, 'THB', 'Revolving', 'BBL',
   current_date - 30, current_date + 335, 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":7,"condition":0,"start_date":"2026-01-01"}]'::jsonb);
