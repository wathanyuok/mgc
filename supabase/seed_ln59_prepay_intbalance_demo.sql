-- ============================================================
-- Seed: LN-59 — คอลัมน์ Interest Balance สอดคล้องกับตารางหลังชำระบางส่วน
--
--   LN-DEMO-59 (Active) · PRINCIPAL 1,200,000 · Fixed 10%/ปี · 12 งวด · รายเดือน
--   Installment ≈ 105,499.06 · ดอกเบี้ยรวมทั้งตาราง ≈ 65,486.47
--
--   วิธีทดสอบ LN-59:
--     1) เปิด LN-DEMO-59 → กด 📋 ลงบัญชีวันเบิกเงิน (→ Active)
--     2) จดยอดคอลัมน์ INTEREST BALANCE (ตามตารางปัจจุบัน) ของงวดต่าง ๆ ไว้
--     3) ทำ "ชำระบางส่วนก่อนกำหนด (Partial Prepayment)" เช่น 300,000
--        → ระบบ re-amortize ตารางใหม่ (toast "✓ Partial Prepayment + re-amortize · JE …")
--     4) ดูคอลัมน์ INTEREST BALANCE อีกครั้ง → ลดลงตามตารางใหม่
--
--   คาดหวัง: Interest Balance = ดอกเบี้ยรวมตารางใหม่ − ดอกเบี้ยสะสมถึงงวดนั้น (ไม่ติดลบ)
--
-- FIELD ครบ · รันซ้ำได้ (ลบ JE ของ loan เดิมด้วย กันค้างตอนรันซ้ำ)
-- ============================================================

-- ลบ JE ที่ผูกกับ loan เดิมชื่อนี้ (เผื่อเคยทดสอบ drawdown/prepay แล้ว)
delete from journal_entries
 where source_id in (select id from loans where loan_no = 'LN-DEMO-59');
delete from loans where loan_no = 'LN-DEMO-59';

insert into loans
  (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, transaction_date, installment_start_date, payment_freq, currency,
   payment_type, pay_eom, allow_prepayment, status, rate_cards, acct_cards, remark)
values
  ('LN-DEMO-59', 'LN-DEMO-59', null, 'KBANK', 1200000, 1200000, 10.0000, 12,
   date '2026-01-01', date '2026-01-01', date '2026-01-31', 'monthly', 'THB',
   'Fix Installment / Fix Installment & Step payment', true, 'yes', 'Active',
   '[{"type":"Fixed","rate":10,"condition":0,"start_date":"2026-01-01"}]'::jsonb,
   '[]'::jsonb,
   'seed LN-59 · ทำ Partial Prepayment แล้วดู Interest Balance คำนวณใหม่');

-- ตรวจผล
select loan_no, status, principal, annual_rate, term_months, allow_prepayment
  from loans where loan_no = 'LN-DEMO-59';
-- คาดหวัง: Active · หลัง Partial Prepayment → Interest Balance ลดลงตามตารางใหม่
