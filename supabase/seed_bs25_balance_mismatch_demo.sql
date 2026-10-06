-- ============================================================
-- Seed: BS-25 — บรรทัดยอดคงเหลือผิดสูตรขึ้นไอคอนเตือน
--
--   ใบแจ้งยอด 3 บรรทัด · สูตร: Expected Balance = ยอดแถวก่อน + Credit − Debit
--     บรรทัด 1: balance 100,000            ← แถวแรก ไม่ถูกตรวจ (ไม่มีแถวก่อนหน้า)
--     บรรทัด 2: +credit 20,000 → 120,000    ← ถูกต้อง (100,000 + 20,000)  · ไม่มีไอคอน
--     บรรทัด 3: −debit 50,000  → ตั้ง 90,000 ← ผิด! สูตรได้ 70,000 (ต่าง 20,000) · ขึ้น ⚠ ส้ม
--
--   คาดหวัง: บรรทัด 3 ขึ้นไอคอน ⚠ · สรุปท้ายตาราง "1 บรรทัดยอดคงเหลือไม่ตรงสูตร"
--
-- วิธีทดสอบ BS-25:
--   เมนู Bank Statement → เปิดใบ account_no "BS25-DEMO-ACCT" → ดูไอคอน ⚠ ที่บรรทัด 3 + แถบสรุป
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (lines ลบตาม cascade)
delete from bank_statements where id = 'b5250000-0000-0000-0000-000000000025' or account_no = 'BS25-DEMO-ACCT';

-- Header
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, remark)
values
  ('b5250000-0000-0000-0000-000000000025', 'KBANK', 'BS25-DEMO-ACCT',
   'BS-25 Demo Statement', '2026-06', 'Manual',
   'seed BS-25 · มี 1 บรรทัดยอดคงเหลือผิดสูตร → ⚠');

-- Lines
insert into bank_statement_lines
  (statement_id, tx_date, txn_code, description, debit, credit, balance, sort_order)
values
  ('b5250000-0000-0000-0000-000000000025', date '2026-06-01', 'OPEN',  'ยอดยกมา',              0,     0,     100000, 1),
  ('b5250000-0000-0000-0000-000000000025', date '2026-06-02', 'TRANSFER', 'รับโอนเข้า',         0,     20000, 120000, 2),  -- ถูก: 100,000 + 20,000
  ('b5250000-0000-0000-0000-000000000025', date '2026-06-03', 'FE',    'จ่ายออก (ยอดผิดสูตร)', 50000, 0,     90000,  3);  -- ผิด: สูตรได้ 70,000

-- ตรวจผล
select tx_date, debit, credit, balance, sort_order
  from bank_statement_lines
 where statement_id = 'b5250000-0000-0000-0000-000000000025'
 order by sort_order;
-- คาดหวัง: บรรทัด 3 (90,000) ผิดสูตร (ควรเป็น 70,000) → ⚠ · สรุป "1 บรรทัดยอดคงเหลือไม่ตรงสูตร"
