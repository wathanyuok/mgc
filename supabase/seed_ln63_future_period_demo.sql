-- ============================================================
-- Seed: LN-63 — ปุ่มลงบัญชีของงวดที่ยังไม่ถึงกำหนด (disable + เตือน)
--
--   LN-DEMO-63 (Active) · PRINCIPAL 1,200,000 · Fixed 10%/ปี · 12 งวด · รายเดือน
--   เริ่มชำระ 30/06/2026 → งวดกระจายคร่อม "วันนี้" (06/10/2026):
--     งวดที่ครบ มิ.ย.–ก.ย. 2026 = ถึงกำหนดแล้ว (ปุ่มกดได้ หลังลงบัญชีวันเบิกเงิน)
--     งวดที่ครบ ต.ค. 2026 เป็นต้นไป = ยังไม่ถึงกำหนด (ปุ่มจาง กดไม่ได้)
--
--   วิธีทดสอบ LN-63:
--     1) เปิด LN-DEMO-63 → กด 📋 ลงบัญชีวันเบิกเงิน (→ Active)
--     2) แท็บ Schedule → งวดที่วันครบงวด > วันนี้ → ปุ่ม "📋 ลงบัญชีงวดนี้" จาง กดไม่ได้
--        ชี้เมาส์ → "ยังไม่ถึงกำหนด (รอวันที่ ...)"
--     3) เทียบกับงวดที่ถึงกำหนดแล้ว → ปุ่มกดได้
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_id in (select id from loans where loan_no = 'LN-DEMO-63');
delete from loans where loan_no = 'LN-DEMO-63';

insert into loans
  (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, transaction_date, installment_start_date, payment_freq, currency,
   payment_type, pay_eom, status, rate_cards, acct_cards, remark)
values
  ('LN-DEMO-63','LN-DEMO-63', null, 'KBANK', 1200000, 1200000, 10.0000, 12,
   date '2026-06-01', date '2026-06-01', date '2026-06-30', 'monthly', 'THB',
   'Fix Installment / Fix Installment & Step payment', true, 'Active',
   '[{"type":"Fixed","rate":10,"condition":0,"start_date":"2026-06-01"}]'::jsonb,
   '[]'::jsonb,
   'seed LN-63 · งวดคร่อมวันนี้ → งวดอนาคตปุ่มจาง "ยังไม่ถึงกำหนด"');

-- ตรวจผล
select loan_no, status, installment_start_date, term_months
  from loans where loan_no = 'LN-DEMO-63';
-- คาดหวัง: Active · งวดที่ครบ > 06/10/2026 → ปุ่มลงบัญชีจาง + tooltip "ยังไม่ถึงกำหนด"
