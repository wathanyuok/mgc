-- ============================================================
-- Seed: TR-68 — แก้ค่าค้างไว้แล้วลงบัญชี → บังคับ Save ก่อน
--
--   TR-DEMO-68 (Active) · AMOUNT 500,000 · Fixed 7%/ปี · 60 วัน
--   สัญญาพร้อมลงบัญชี — ใช้ทดสอบว่าถ้าแก้ค่าค้างไว้ (dirty) แล้วกดลงบัญชี ระบบบังคับ Save ก่อน
--
-- วิธีทดสอบ TR-68:
--   1) เปิด TR-DEMO-68 (Active)
--   2) แก้ช่องใดช่องหนึ่ง (เช่น AMOUNT / วันที่) แต่ยังไม่กด Save
--   3) กดปุ่มลงบัญชี → ขึ้น "ค่าบนหน้าจอยังไม่ถูกบันทึก — กด Save ก่อนลงบัญชี"
--   4) กด Save แล้วลงบัญชีอีกครั้ง → ทำได้ปกติ
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_id in (select id from trust_receipts where tr_no = 'TR-DEMO-68');
delete from trust_receipts where tr_no = 'TR-DEMO-68';

insert into trust_receipts
  (tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days, amount, currency,
   status, rate_cards, acct_cards, remark)
values
  ('TR-DEMO-68', 'TR-DEMO-68', null, 'KBANK', 'บจก. ซัพพลายเออร์เดโม', 'INV-TR68-001', date '2026-09-01',
   date '2026-09-01', date '2026-10-31', date '2026-10-31', 60, 500000, 'THB',
   'Active',
   '[{"type":"Fixed","rate":7,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'seed TR-68 · Active · แก้ค่าค้างแล้วลงบัญชีต้องบังคับ Save ก่อน');

-- ตรวจผล
select tr_no, status, amount, due_date, rate_cards
  from trust_receipts where tr_no = 'TR-DEMO-68';
-- คาดหวัง: Active · แก้ช่องแล้วกดลงบัญชีโดยไม่ Save → "ค่าบนหน้าจอยังไม่ถูกบันทึก — กด Save ก่อนลงบัญชี"
