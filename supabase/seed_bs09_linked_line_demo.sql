-- ============================================================
-- Seed: BS-09 — ลบใบแจ้งยอดที่มีบรรทัดผูกกับสัญญา → ถูกบล็อก (BR-MST-BS-003)
--
--   สร้าง Bank Statement 1 ใบ + บรรทัด 2 รายการ
--     - บรรทัด 1: ผูกสัญญาแล้ว (facility_id ไม่ว่าง · facility_type = Lease)
--     - บรรทัด 2: ยังไม่ผูก (facility_id ว่าง)
--   → ลองลบใบนี้ → ระบบบล็อก "ลบไม่ได้ — ใช้งานโดย: 1 Lease/HP link · กรุณา unlink ก่อน"
--
-- วิธีทดสอบ BS-09:
--   เมนู Bank Statement → หาใบ account_no "BS09-DEMO-ACCT" → กดถังขยะ → ยืนยัน
--   → toast แดง: "ลบไม่ได้ — ใช้งานโดย: 1 Lease/HP link · กรุณา unlink ก่อน"
--
-- หมายเหตุ: การบล็อกนับบรรทัดที่ facility_id ไม่ว่าง (ผูกสัญญาแล้ว)
--           account_no ตั้งให้ไม่ชนกับ Overdraft ใด เพื่อให้ข้อความมีแค่ Lease/HP link
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (lines ลบตาม cascade เมื่อลบ header)
delete from bank_statements where id = 'b5090000-0000-0000-0000-000000000009' or account_no = 'BS09-DEMO-ACCT';

-- 1) Header
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, remark)
values
  ('b5090000-0000-0000-0000-000000000009', 'KBANK', 'BS09-DEMO-ACCT',
   'BS-09 Demo Statement', '2026-06', 'Manual',
   'seed BS-09 · มีบรรทัดผูกสัญญา → ลบไม่ได้');

-- 2) บรรทัดที่ผูกสัญญาแล้ว (facility_id ไม่ว่าง) — ตัวที่ทำให้ลบไม่ได้
--    หมายเหตุ: คอลัมน์ facility_type (text) ถูกเปลี่ยนเป็น facility_type_id (FK) แล้ว (migration 0074)
insert into bank_statement_lines
  (statement_id, tx_date, txn_code, description, debit, credit, balance,
   facility_type_id, facility_id, source_period, sort_order)
values
  ('b5090000-0000-0000-0000-000000000009', date '2026-06-05', 'TRANSFER',
   'ตัดชำระค่างวด (ผูกกับสัญญา Lease)', 23619.19, 0, 100000,
   (select id from facility_types where code = 'LEASE' limit 1),
   'd9d9ea50-0000-0000-0000-000000005025', 1, 1);

-- 3) บรรทัดที่ยังไม่ผูก (facility_id ว่าง) — มีไว้ให้เห็นว่านับเฉพาะบรรทัดที่ผูก
insert into bank_statement_lines
  (statement_id, tx_date, txn_code, description, debit, credit, balance, sort_order)
values
  ('b5090000-0000-0000-0000-000000000009', date '2026-06-06', 'FE',
   'รายการที่ยังไม่จับคู่สัญญา', 5000, 0, 95000, 2);

-- ตรวจผล
select bs.account_no,
       count(bl.id) as total_lines,
       count(bl.facility_id) as linked_lines
  from bank_statements bs
  left join bank_statement_lines bl on bl.statement_id = bs.id
 where bs.id = 'b5090000-0000-0000-0000-000000000009'
 group by bs.account_no;
-- คาดหวัง: total_lines = 2 · linked_lines = 1 → ลบ → บล็อก "1 Lease/HP link"
