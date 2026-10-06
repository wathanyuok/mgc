-- ============================================================
-- Seed: IR-12 — ลบอัตราที่ถูกใช้ในวงเงิน (Credit Agreement) → ถูกบล็อก
--
--   สร้าง 1 อัตราดอกเบี้ย (interest_type = MRR) + 1 วงเงินที่ใช้ประเภท MRR
--   โดยไม่ตั้งที่ธุรกรรมใด → ลองลบอัตรา MRR → ระบบบล็อก "ถูกใช้อยู่ที่ วงเงิน N รายการ"
--
--   (ยืนยันว่าการตรวจครอบ credit_agreements แล้ว — เดิมตรวจแค่ 5 โมดูลธุรกรรม)
--
-- วิธีทดสอบ IR-12:
--   1) เมนู Interest Rate → กรองธนาคาร "IR12-DEMO-BANK" (หรือ interest_type = MRR)
--   2) กดถังขยะ → ยืนยัน "ลบ Interest Rate #{id}?" → กดตกลง
--   3) toast แดง: "ลบไม่ได้ — อัตรา MRR ของ IR12-DEMO-BANK ถูกใช้อยู่ที่ วงเงิน N รายการ ..."
--
-- หมายเหตุ: จับคู่ด้วย interest_type (MRR) ใน rate_cards · ถ้ามีวงเงินอื่นใช้ MRR ด้วย N อาจ > 1
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (รันซ้ำได้)
delete from credit_agreements where contract_number = 'CA-IR12-DEMO';
delete from interest_rates     where finance_institution = 'IR12-DEMO-BANK' and interest_type = 'MRR';

-- 1) อัตราดอกเบี้ยประเภท MRR ที่จะถูกลบ
insert into interest_rates
  (finance_institution, interest_type, base_rate, margin, date_effective, status, remark)
values
  ('IR12-DEMO-BANK', 'MRR', 6.5000, 0.0000, date '2026-01-01', 'Active', 'seed IR-12 · อัตราที่ถูกใช้ในวงเงิน → ลบไม่ได้');

-- 2) วงเงิน (Credit Agreement) ที่ใช้ประเภท MRR — ทำให้ลบอัตราข้างบนไม่ได้
--    หมายเหตุ: คอลัมน์ facility_type ถูกเปลี่ยนเป็น facility_type_id (FK) ตั้งแต่ migration 0073
insert into credit_agreements
  (ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line,
   start_date, end_date, status, rate_cards)
values
  (null, 'CA-IR12-DEMO', 'CA-IR12-DEMO', 'MGC',
   (select id from facility_types where code = 'LOAN' limit 1), 10000000,
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[{"type":"MRR","rate":6.5,"condition":"ตลอดอายุวงเงิน"}]'::jsonb);

-- ตรวจผล
select id, finance_institution, interest_type, effective_rate, status
  from interest_rates where finance_institution = 'IR12-DEMO-BANK' and interest_type = 'MRR';
select ca_name, contract_number, status, rate_cards
  from credit_agreements where contract_number = 'CA-IR12-DEMO';
-- คาดหวัง: ลบอัตรา MRR นี้ → บล็อก · ข้อความ "ถูกใช้อยู่ที่ วงเงิน 1 รายการ"
