-- ============================================================
-- Seed: LN-58 — ยอดในใบสำคัญดอกเบี้ยค้างจ่าย = คอลัมน์ Interest ของแถวนั้น
--
--   LN-DEMO-58 (Active) · PRINCIPAL 1,200,000 · Fixed 10%/ปี · 12 งวด · รายเดือน
--   *** ดอกเบี้ยคิดรายวันฐาน 365 · งวดนับจากวันสิ้นงวด (EOM) ***
--     ตารางจริง (จากหน้าจอ):
--       งวด 1 · 31/01→28/02 · 28 วัน · Interest = 9,205.48
--       งวด 2 · 28/02→31/03 · 31 วัน · Interest = 9,373.94
--       งวด 3 · 31/03→30/04 · 30 วัน · Interest = 8,281.49
--     Installment (คงที่) = 105,499.06
--
--   คาดหวัง: ลงบัญชีดอกเบี้ยค้างจ่ายงวด 1 → Dr ดอกเบี้ยจ่าย 9,205.48 / Cr ดอกเบี้ยค้างจ่าย 9,205.48
--            = เลขคอลัมน์ Interest ของงวด 1 (ไม่ใช่คอลัมน์ "Accrued สิ้นงวด→สิ้นเดือน" ซึ่ง = 0.00)
--
-- วิธีทดสอบ LN-58:
--   เปิด LN-DEMO-58 → แท็บ Schedule → ดูคอลัมน์ Interest ของงวดหนึ่ง
--   → ลงบัญชีดอกเบี้ยค้างจ่ายงวดนั้น → เปิดใบสำคัญ เทียบยอด = คอลัมน์ Interest
--
-- หมายเหตุ: ถ้าปุ่มลงบัญชีต้องการตารางงวดในฐานข้อมูล ให้เปิดสัญญาแล้วกด Save 1 ครั้งก่อน
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from loans where loan_no = 'LN-DEMO-58';

insert into loans
  (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, transaction_date, installment_start_date, payment_freq, currency,
   payment_type, pay_eom, status, rate_cards, acct_cards, remark)
values
  ('LN-DEMO-58', 'LN-DEMO-58', null, 'KBANK', 1200000, 1200000, 10.0000, 12,
   date '2026-01-01', date '2026-01-01', date '2026-01-31', 'monthly', 'THB',
   'Fix Installment / Fix Installment & Step payment', true, 'Active',
   '[{"type":"Fixed","rate":10,"condition":0,"start_date":"2026-01-01"}]'::jsonb,
   '[]'::jsonb,
   'seed LN-58 · Fixed 10% · งวด 1 ดอกเบี้ย ~10,000 · ใบสำคัญดอกเบี้ยค้างจ่าย = คอลัมน์ Interest');

-- ตรวจผล
select loan_no, status, principal, annual_rate, term_months,
       round(principal::numeric * 10 / 100 * 28 / 365, 2) as interest_period1_28days
  from loans where loan_no = 'LN-DEMO-58';
-- คาดหวัง: Active · งวด 1 Interest = 9,205.48 (28 วัน) · ใบสำคัญดอกเบี้ยค้างจ่าย = 9,205.48 (ตรงคอลัมน์ Interest)
