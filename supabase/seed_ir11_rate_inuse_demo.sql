-- ============================================================
-- Seed: IR-11 — ลบอัตราดอกเบี้ยที่มีสัญญาใช้อยู่ → ถูกบล็อก (BR-MST-IR-002)
--
--   สร้าง 1 อัตราดอกเบี้ย (interest_type = MOR) + 1 เงินกู้ที่ใช้ประเภท MOR
--   → ลองลบอัตรา MOR นั้น → ระบบบล็อก + ขึ้นข้อความ "ถูกใช้อยู่ที่ เงินกู้ N รายการ"
--
-- วิธีทดสอบ IR-11:
--   1) เมนู Interest Rate → กรองธนาคาร "IR11-DEMO-BANK" (หรือ interest_type = MOR)
--   2) กดไอคอนถังขยะที่อัตรานั้น → กล่องยืนยัน "ลบ Interest Rate #{id}?" → กดตกลง
--   3) ขึ้น toast แดง: "ลบไม่ได้ — อัตรา MOR ของ IR11-DEMO-BANK ถูกใช้อยู่ที่ เงินกู้ N รายการ ..."
--
-- หมายเหตุ: ระบบจับคู่ด้วย interest_type (MOR) ใน rate_cards ของทุกโมดูล
--           ถ้ามีสัญญาอื่นใช้ MOR อยู่ด้วย ตัวเลข N อาจมากกว่า 1 (ยังบล็อกเหมือนกัน)
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (รันซ้ำได้)
delete from loans          where loan_no = 'LN-IR11-DEMO';
delete from interest_rates where finance_institution = 'IR11-DEMO-BANK' and interest_type = 'MOR';

-- 1) อัตราดอกเบี้ยประเภท MOR ที่จะถูกลบ
insert into interest_rates
  (finance_institution, interest_type, base_rate, margin, date_effective, status, remark)
values
  ('IR11-DEMO-BANK', 'MOR', 7.0000, 0.0000, date '2026-01-01', 'Active', 'seed IR-11 · อัตราที่ถูกใช้ในเงินกู้ → ลบไม่ได้');

-- 2) เงินกู้ที่ใช้ประเภท MOR (rate_cards มี type = MOR) → ทำให้ลบอัตราข้างบนไม่ได้
insert into loans
  (loan_no, ca_id, finance_institution, principal, annual_rate, term_months, start_date, end_date,
   payment_freq, status, rate_cards, remark)
values
  ('LN-IR11-DEMO', null, 'IR11-DEMO-BANK', 500000, 7.0000, 12, date '2026-01-01', date '2026-12-31',
   'monthly', 'Active',
   '[{"type":"MOR","rate":7.0,"condition":"ตลอดอายุสัญญา"}]'::jsonb,
   'seed IR-11 · เงินกู้ที่ผูกอัตรา MOR — ใช้บล็อกการลบอัตรา');

-- ตรวจผล
select id, finance_institution, interest_type, effective_rate, status
  from interest_rates where finance_institution = 'IR11-DEMO-BANK' and interest_type = 'MOR';
select loan_no, finance_institution, status, rate_cards
  from loans where loan_no = 'LN-IR11-DEMO';
-- คาดหวัง: ลบอัตรา MOR นี้ → บล็อก · ข้อความ "ถูกใช้อยู่ที่ เงินกู้ 1 รายการ"
