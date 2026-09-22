-- =====================================================================
-- Seed: TR-08 ลบรายการ (UC-TR-004) — เดโมกฎการลบทรัสต์รีซีท
-- =====================================================================
-- สร้าง 3 เคสไว้กดปุ่มถังขยะที่หน้า Trust Receipt (/tx/tr) เพื่อดูผลต่างกัน:
--
--   1) TR-DEMO-08-DRAFT   สถานะ Draft   · ไม่มีใบสำคัญ  → ลบได้ (ขึ้นกล่องยืนยัน แล้วลบสำเร็จ)
--   2) TR-DEMO-08-CANCEL  สถานะ Cancelled · ไม่มีใบสำคัญ → ลบได้เช่นกัน
--   3) TR-DEMO-08-POSTED  สถานะ Active   · มีใบสำคัญ Posted (TR_DRAWDOWN) → ลบไม่ได้
--        กดลบแล้วต้องเด้ง error:
--        "ลบไม่ได้ — สัญญานี้มีใบสำคัญผูกอยู่ (JE-DEMO-TR08) ..."
--
-- หมายเหตุ: guard เช็คแค่ว่ามีแถวใน journal_entries ที่ source_id = TR นี้ไหม
--          (ไม่กรองสถานะ JE) — ใบ Posted ในเคส 3 จึงบล็อกการลบ
--
-- รันซ้ำได้ (ลบของเดิมชื่อเดียวกันก่อนทุกครั้ง)
-- =====================================================================

-- ── ล้างของเดิม (JE ก่อน แล้วค่อย TR) ────────────────────────────────
delete from journal_entries
 where source_id in (
   select id from trust_receipts
    where tr_no in ('TR-DEMO-08-DRAFT', 'TR-DEMO-08-CANCEL', 'TR-DEMO-08-POSTED')
 );   -- je_lines ถูกลบตาม (ON DELETE CASCADE)
delete from trust_receipts
 where tr_no in ('TR-DEMO-08-DRAFT', 'TR-DEMO-08-CANCEL', 'TR-DEMO-08-POSTED');

-- ── เคส 1: Draft · ไม่มีใบสำคัญ → ลบได้ ──────────────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-08-DRAFT', 'TR เดโม 08 — ร่าง (ลบได้)', 'BBL', 'Toyota Tsusho',
   'INV-08-001', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   1000000, 1000000, 'THB', 'Draft');

-- ── เคส 2: Cancelled · ไม่มีใบสำคัญ → ลบได้ ──────────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-08-CANCEL', 'TR เดโม 08 — ยกเลิก (ลบได้)', 'BBL', 'Toyota Tsusho',
   'INV-08-002', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   1500000, 1500000, 'THB', 'Cancelled');

-- ── เคส 3: Active · มีใบสำคัญ Posted → ลบไม่ได้ ──────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-08-POSTED', 'TR เดโม 08 — ลงบัญชีแล้ว (ลบไม่ได้)', 'BBL', 'Toyota Tsusho',
   'INV-08-003', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   2000000, 2000000, 'THB', 'Active');

-- ใบสำคัญวันเบิกเงิน (TR_DRAWDOWN) สถานะ Posted ผูกกับ TR เคส 3
-- Dr สินค้าคงเหลือ 2,000,000 / Cr เงินกู้ยืมระยะสั้น 2,000,000
with tr as (
  select id from trust_receipts where tr_no = 'TR-DEMO-08-POSTED' limit 1
), je as (
  insert into journal_entries
    (je_number, source_type, source_id, source_period, je_date, posting_period,
     description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
  select
    'JE-DEMO-TR08', 'TR_DRAWDOWN', tr.id, 0, '2026-09-01', 'Sep 2026',
    'TR เดโม 08 — T/R Drawdown', 2000000, 2000000, 'Posted', 'system', now(), false,
    'Supplier: Toyota Tsusho · THB 2,000,000'
  from tr
  returning id
)
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
select je.id, 1, '1151101', 'สินค้าคงเหลือ-ยานพาหนะ', 2000000, 0, 'Imported goods financed via T/R' from je
union all
select je.id, 2, '2142101', 'เงินกู้ยืมระยะสั้น-สถาบันการเงิน', 0, 2000000, 'Note Payable — Trust Receipt' from je;
