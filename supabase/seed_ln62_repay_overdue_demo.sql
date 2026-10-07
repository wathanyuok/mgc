-- ============================================================
-- Seed: LN-62 — งวดที่ชำระแล้ว หลุดจากรายงานค้างชำระ
--
--   LN-DEMO-62 (Active) · PRINCIPAL 1,200,000 · Fixed 10%/ปี · 12 งวด · รายเดือน
--   เริ่ม ม.ค. 2026 → งวด ม.ค.–ก.ย. 2026 "เลยกำหนดแล้ว" (overdue ณ วันทดสอบ)
--
--   วิธีทดสอบ LN-62:
--     1) เปิด LN-DEMO-62 → กด 📋 ลงบัญชีวันเบิกเงิน (→ Active) → กด Save 1 ครั้ง
--        (ให้ระบบ sync ตารางงวดเข้าตารางกลาง installment_schedules → ขึ้นในรายงาน)
--     2) Reports → Overdue Payment Report → ค้นหา "LN-DEMO-62" → เห็นงวดที่เลยกำหนด
--     3) เมนู Repayment → ตัดชำระ 1 งวดของ LN-DEMO-62 (Posted)
--     4) กลับมา Overdue Payment Report → งวดที่ชำระแล้ว "หลุดออก"
--        + แท็บ Reconcile ของสัญญา → งวดนั้นถูกทำเครื่องหมาย (ถ้าจับคู่บรรทัดใบแจ้งยอด)
--
-- หมายเหตุ: การตัดชำระทำในแอป (เมนู Repayment) ไม่ต้อง seed repayment
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries
 where source_id in (select id from loans where loan_no = 'LN-DEMO-62');
delete from loans where loan_no = 'LN-DEMO-62';

insert into loans
  (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, transaction_date, installment_start_date, payment_freq, currency,
   payment_type, pay_eom, status, rate_cards, acct_cards, remark)
values
  ('LN-DEMO-62', 'LN-DEMO-62', null, 'KBANK', 1200000, 1200000, 10.0000, 12,
   date '2026-01-01', date '2026-01-01', date '2026-01-31', 'monthly', 'THB',
   'Fix Installment / Fix Installment & Step payment', true, 'Active',
   '[{"type":"Fixed","rate":10,"condition":0,"start_date":"2026-01-01"}]'::jsonb,
   '[]'::jsonb,
   'seed LN-62 · มีงวดเลยกำหนด → ตัดชำระที่ Repayment แล้วงวดหลุดจากรายงานค้างชำระ');

-- ตรวจผล
select loan_no, status, principal, term_months, installment_start_date
  from loans where loan_no = 'LN-DEMO-62';
-- คาดหวัง: Active · หลัง Save → งวดเลยกำหนดขึ้น Overdue Report · ตัดชำระแล้วงวดนั้นหลุดออก
