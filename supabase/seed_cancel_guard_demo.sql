-- =====================================================================
-- Seed: Cancel Guard — เดโมกติกากลาง "ยกเลิกสัญญา (Cancelled) ได้เมื่อไร"
-- =====================================================================
-- ใช้โมดูล Trust Receipt (/tx/tr) เป็นตัวอย่าง · เปิดแต่ละใบแล้วลองเปลี่ยน
-- ช่องสถานะเป็น "Cancelled" แล้วกด Save เพื่อดูผลต่างกัน 3 เคส:
--
--   1) TR-DEMO-CX-CLEAN   Active · ไม่มี JE · ไม่มีการชำระ
--        → ยกเลิกได้ (บันทึกผ่าน สถานะเป็น Cancelled)  ✅
--
--   2) TR-DEMO-CX-POSTED  Active · มีใบสำคัญ Posted (TR_DRAWDOWN)
--        → ยกเลิกไม่ได้ · เด้ง:
--          "T/R นี้มีใบสำคัญที่ลงบัญชีแล้ว (JE-DEMO-CX) — ยกเลิกไม่ได้ ·
--           ให้กลับรายการใบสำคัญก่อน หรือใช้ ปิดสัญญา แทนการยกเลิก"  ❌
--
--   3) TR-DEMO-CX-CLOSED  Closed (จบแล้ว/terminal)
--        → ยกเลิกไม่ได้ · เด้ง:
--          "T/R นี้จบแล้ว (Closed) — ยกเลิกไม่ได้ · ปรับสถานะกลับก่อน"  ❌
--        (เคสนี้ช่องสถานะจะให้เลือกได้จำกัด เพราะ Closed เป็น read-only —
--         ต้อง revert เป็น Draft ก่อน จึงจะแตะได้ · เป็นพฤติกรรมที่ถูกต้อง)
--
-- รันซ้ำได้ (ลบของเดิมชื่อเดียวกันก่อนทุกครั้ง)
-- =====================================================================

-- ── ล้างของเดิม (JE ก่อน แล้วค่อย TR) ────────────────────────────────
delete from journal_entries
 where source_id in (
   select id from trust_receipts
    where tr_no in ('TR-DEMO-CX-CLEAN', 'TR-DEMO-CX-POSTED', 'TR-DEMO-CX-CLOSED')
 );
delete from trust_receipts
 where tr_no in ('TR-DEMO-CX-CLEAN', 'TR-DEMO-CX-POSTED', 'TR-DEMO-CX-CLOSED');

-- ── เคส 1: Active · ไม่มีกิจกรรมบัญชี → ยกเลิกได้ ────────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-CX-CLEAN', 'Cancel เดโม — Active ยังไม่ลงบัญชี (ยกเลิกได้)', 'BBL', 'Toyota Tsusho',
   'INV-CX-001', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   1200000, 1200000, 'THB', 'Active');

-- ── เคส 2: Active · มีใบสำคัญ Posted → ยกเลิกไม่ได้ ──────────────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-CX-POSTED', 'Cancel เดโม — Active ลงบัญชีแล้ว (ยกเลิกไม่ได้)', 'BBL', 'Toyota Tsusho',
   'INV-CX-002', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   1800000, 1800000, 'THB', 'Active');

with tr as (
  select id from trust_receipts where tr_no = 'TR-DEMO-CX-POSTED' limit 1
), je as (
  insert into journal_entries
    (je_number, source_type, source_id, source_period, je_date, posting_period,
     description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
  select
    'JE-DEMO-CX', 'TR_DRAWDOWN', tr.id, 0, '2026-09-01', 'Sep 2026',
    'Cancel เดโม — T/R Drawdown', 1800000, 1800000, 'Posted', 'system', now(), false,
    'Supplier: Toyota Tsusho · THB 1,800,000'
  from tr
  returning id
)
insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
select je.id, 1, '1151101', 'สินค้าคงเหลือ-ยานพาหนะ', 1800000, 0, 'Imported goods financed via T/R' from je
union all
select je.id, 2, '2142101', 'เงินกู้ยืมระยะสั้น-สถาบันการเงิน', 0, 1800000, 'Note Payable — Trust Receipt' from je;

-- ── เคส 3: Closed (จบแล้ว) → ยกเลิกไม่ได้ (ต้อง revert ก่อน) ──────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, term_days, amount, amount_foreign, currency, status)
values
  ('TR-DEMO-CX-CLOSED', 'Cancel เดโม — Closed จบแล้ว (ยกเลิกไม่ได้)', 'BBL', 'Toyota Tsusho',
   'INV-CX-003', '2026-09-01', '2026-09-01', '2026-12-01', 91,
   1000000, 1000000, 'THB', 'Closed');
