-- =====================================================================
-- Seed: TR-36 (UC-TR / เปลี่ยนบัญชีแล้วลงบัญชี) — ใบสำคัญใช้บัญชีที่ผูกไว้
-- =====================================================================
-- ทดสอบว่า "รหัสบัญชีในใบสำคัญวันเบิกเงิน" มาจากแท็บ Accounting (acct_cards)
-- ที่ผู้ใช้ผูกไว้ ไม่ใช่รหัส default ที่ฝังในโค้ด
--
--   ค่า default ในโค้ด (เมื่อไม่ผูก acct_cards):
--     Dr  INVENTORY ACCOUNT     = 1151101 สินค้าคงเหลือ-ยานพาหนะ
--     Cr  NOTE PAYABLE ACCOUNT  = 2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน
--
-- สร้าง 2 ใบให้เทียบกัน (ทั้งคู่สถานะ Approved · พร้อมกดลงบัญชี):
--   A) TR-DEMO-36-MAP   — ผูก acct_cards เป็นรหัส "อื่น" → ใบสำคัญต้องใช้รหัสที่ผูก
--   B) TR-DEMO-36-DEF   — ไม่ผูก acct_cards → ใบสำคัญใช้รหัส default
--
-- ── วิธีทดสอบ (ต้องล็อกอินด้วยบัญชีที่มีสิทธิ์ tr.approve เช่น Admin) ──
--   1) เปิด Trust Receipt → TR-DEMO-36-MAP
--   2) แท็บ "Accounting" → เห็น 2 การ์ด:
--        INVENTORY ACCOUNT    → 1151102 สินค้าคงเหลือ-ยานพาหนะ (ทดสอบ)
--        NOTE PAYABLE ACCOUNT → 2141101 เงินกู้ยืมระยะสั้น-Parent
--   3) กดปุ่ม "📋 ลงบัญชีวันเบิกเงิน" (แถวปุ่มบนสุด) → สถานะเด้งเป็น Active
--   4) เมนูซ้าย "Journal Entries" → เปิดใบของ T/R นี้ → ตรวจ:
--        Dr = 1151102 (ไม่ใช่ 1151101 default)   ✓ ผ่าน
--        Cr = 2141101 (ไม่ใช่ 2142101 default)   ✓ ผ่าน
--   5) เทียบกับ TR-DEMO-36-DEF (ไม่ผูกบัญชี) → กดลงบัญชี → ใบสำคัญได้ 1151101 / 2142101
--
-- หมายเหตุ: acct_cards แต่ละรายการมีรูปแบบ { type, gl } โดย gl = "รหัส<เว้นวรรค>ชื่อ"
--          ระบบตัดคำแรกก่อนช่องว่างเป็น account_code ที่เหลือเป็น account_name
-- รันซ้ำได้ (ลบ JE ที่เคยเกิดจากการกดปุ่ม + TR ของเดิมก่อน)
-- =====================================================================

-- ── ล้างของเดิม (เผื่อเคยกด Post จนเกิด JE) ──────────────────────────
delete from journal_entries
 where source_id in (
   select id from trust_receipts
    where tr_no in ('TR-DEMO-36-MAP', 'TR-DEMO-36-DEF')
 );
delete from trust_receipts
 where tr_no in ('TR-DEMO-36-MAP', 'TR-DEMO-36-DEF');

-- ── A) ผูกบัญชีเป็นรหัส "อื่น" → ใบสำคัญต้องใช้รหัสที่ผูก ────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   amount, amount_foreign, currency, status, rate_cards, acct_cards)
values
  ('TR-DEMO-36-MAP', 'TR-36 — ผูกบัญชีเอง (Dr 1151102 / Cr 2141101)', 'BBL', 'Toyota Tsusho',
   'INV-36-001', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   1500000, 1500000, 'THB', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151102 สินค้าคงเหลือ-ยานพาหนะ (ทดสอบ)"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2141101 เงินกู้ยืมระยะสั้น-Parent"}]'::jsonb);

-- ── B) ไม่ผูกบัญชี → ใบสำคัญใช้รหัส default ในโค้ด ────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   amount, amount_foreign, currency, status, rate_cards)
values
  ('TR-DEMO-36-DEF', 'TR-36 — ไม่ผูกบัญชี (default 1151101 / 2142101)', 'BBL', 'Toyota Tsusho',
   'INV-36-002', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   1500000, 1500000, 'THB', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb);
