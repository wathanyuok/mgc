-- =====================================================================
-- Seed: TR-40 (FR-TR-002 / FR-TR-003 · UC-TR-001) — สกุลเงินของสินค้า
-- =====================================================================
-- ทดสอบว่า "เลือกสินค้านำเข้าได้เฉพาะสกุลเดียวกับสัญญา" — สินค้าคนละสกุล
-- จะไม่ปรากฏให้เลือก (ระบบกันที่ต้นทาง ไม่ใช่แค่เตือน)
--
-- สร้าง 3 ใบ สกุลต่างกัน ให้เปิดทดสอบตัวกรองในแท็บ "Imported Goods":
--   TR-DEMO-40-USD  (CURRENCY = USD)  → picker โชว์เฉพาะสินค้า USD (2 ใบ)
--   TR-DEMO-40-EUR  (CURRENCY = EUR)  → picker โชว์เฉพาะสินค้า EUR (6 ใบ)
--   TR-DEMO-40-THB  (CURRENCY = THB)  → picker ไม่มีสินค้าให้เลือก (mock มีแต่ USD/EUR)
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Trust Receipt → TR-DEMO-40-USD
--   2) แท็บ "Imported Goods" → ปุ่ม "🔍 ค้นหาสินค้านำเข้า"
--        หัว modal: "🔍 ค้นหาสินค้านำเข้า — สกุล USD"
--        โชว์เฉพาะ USD: INV-IMP-2023-0421, INV-IMP-2024-0354 (EUR หายหมด)
--   3) เปิด TR-DEMO-40-EUR → ทำแบบเดียวกัน → โชว์เฉพาะ EUR 6 ใบ
--   4) เปิด TR-DEMO-40-THB → เปิด picker → "ไม่พบใบกำกับที่เลือกได้ …
--        หรือเป็นคนละสกุลกับสัญญานี้"
--
-- หมายเหตุสำคัญ:
--   • รายการสินค้านำเข้าเป็น MOCK ในโค้ด (MOCK_PURCHASE_ORDERS) ไม่ได้อยู่ใน DB
--     seed นี้จึงสร้างแค่ "ตัวสัญญา T/R" ที่สกุลต่างกัน เพื่อเปิดดูผลของตัวกรอง
--   • ตั้งสถานะ Draft พอ — การทดสอบนี้ไม่ต้องอนุมัติ/ลงบัญชี
-- รันซ้ำได้ (ลบของเดิมก่อน)
-- =====================================================================

delete from trust_receipts
 where tr_no in ('TR-DEMO-40-USD', 'TR-DEMO-40-EUR', 'TR-DEMO-40-THB');

-- ── USD → picker โชว์เฉพาะสินค้า USD ─────────────────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   currency, amount_foreign, conversion_rate, conversion_date, amount, status)
values
  ('TR-DEMO-40-USD', 'TR-40 — สัญญาสกุล USD (เลือกได้เฉพาะสินค้า USD)', 'BBL', 'BMW (Thailand) Co., Ltd.',
   'INV-40-USD', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   'USD', 200000, 35, '2026-09-01', 7000000, 'Draft');

-- ── EUR → picker โชว์เฉพาะสินค้า EUR ─────────────────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   currency, amount_foreign, conversion_rate, conversion_date, amount, status)
values
  ('TR-DEMO-40-EUR', 'TR-40 — สัญญาสกุล EUR (เลือกได้เฉพาะสินค้า EUR)', 'BBL', 'BMW AG (Munich)',
   'INV-40-EUR', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   'EUR', 200000, 38, '2026-09-01', 7600000, 'Draft');

-- ── THB → picker ไม่มีสินค้าให้เลือก (mock ไม่มีสกุล THB) ────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   currency, amount, status)
values
  ('TR-DEMO-40-THB', 'TR-40 — สัญญาสกุล THB (ไม่มีสินค้าให้เลือก)', 'BBL', 'Toyota Tsusho',
   'INV-40-THB', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   'THB', 5000000, 'Draft');
