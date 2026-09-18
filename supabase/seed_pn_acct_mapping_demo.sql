-- ============================================================
-- Seed: PN-38 — แท็บ Accounting ผูกผังบัญชีเอง (override บัญชีตั้งต้น)
-- P/N (Active) · เงินต้น 1,000,000 · 5% · 01/09/2026 → 01/12/2026 (3 งวด)
-- ยังไม่ลงใบสำคัญ → กด "ลงบัญชีวันเบิกเงิน" + "ลงบัญชีงวดนี้" ได้ทันที
--
-- acct_cards ถูกตั้งไว้ให้ใช้บัญชีที่ "ไม่ใช่ค่าตั้งต้น" เพื่อพิสูจน์ว่า
-- ใบสำคัญที่ลงจะใช้บัญชีตามที่เลือกในแท็บ Accounting จริง:
--   CASH / BANK       → 1001205 KBANK   (ตั้งต้นคือ 1001201 BBL)
--   INTEREST EXPENSE  → 5512106 Non RPT (ตั้งต้นคือ 5512109 PN)
--   ACCRUED INTEREST  → 2197106 Non RPT (ตั้งต้นคือ 2197109 สถาบันการเงิน)
--   NOTE PAYABLE      → 2142101 (มีรหัสเดียวในผัง — ผูกไว้ให้ครบ)
--
-- ทดสอบ: เปิด PN-DEMO-ACCT-001 → แท็บ Accounting เห็นการ์ด 4 ใบที่ผูกไว้
--   → แท็บ Schedule → กด "📋 ลงบัญชีวันเบิกเงิน" → เปิดใบสำคัญ
--     บรรทัด Dr ต้องเป็น 1001205 (KBANK) ไม่ใช่ 1001201 (BBL)
--   → กด "📋 ลงบัญชีงวดนี้" → Dr 5512106 / Cr 2197106
-- ============================================================

delete from promissory_notes where pn_number = 'PN-DEMO-ACCT-001';

insert into promissory_notes
  (name, pn_number, finance_institution, facility_type_id,
   transaction_date, maturity_date, term_days, amount, currency, status,
   rate_cards, acct_cards)
values
  ('PN-DEMO-ACCT', 'PN-DEMO-ACCT-001', 'KBANK',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-09-01', '2026-12-01', 91, 1000000, 'THB', 'Active',
   '[
      {"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}
    ]'::jsonb,
   '[
      {"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001205 C/A - KBANK#202-1-68280-5"},
      {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
      {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512106 ดอกเบี้ยจ่าย-Loan from Non RPT"},
      {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197106 ดอกเบี้ยค้างจ่าย-Loan from Non RPT"}
    ]'::jsonb);

-- ตรวจ: แท็บ Accounting เห็นการ์ด 4 ใบ · ลงบัญชีวันเบิกเงินแล้ว Dr = 1001205 (KBANK) ไม่ใช่ 1001201
--   เทียบกับ PN ที่ไม่ผูก acct_cards → ใบสำคัญจะใช้ตั้งต้น 1001201 (BBL) แทน
