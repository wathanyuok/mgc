-- ============================================================
-- Seed: LG-50 — ยกเลิกก่อนกำหนด แบบ Expense (ไม่ติ๊ก PREPAID) → ไม่มีเงินคืน
-- LG (Active) · Mode = Expense (prepaid = false) · Fee Paid 90,000
--
-- ทดสอบ: เปิด LG-DEMO-TERM-050 → ปุ่ม Actions (มุมขวาบน) → ⚠️ Terminate B/G, L/G
--   หน้าต่างยกเลิก: แถบข้อมูลโชว์ Mode: Expense
--   กล่อง "📐 คำนวณ Pro-rata Refund" ขึ้น "Expense Mode — ไม่มี Refund (recognize เต็มจำนวนแล้ว)"
--   ท้ายหน้าต่าง: "ไม่มี Refund JE" · Status → Pending Termination (รออนุมัติ) → Terminated
--
-- เทียบ: ถ้าอยากเห็นแบบมีเงินคืน ให้ตั้ง prepaid = true (จะคำนวณ Fee × วันคงเหลือ/วันทั้งหมด)
-- ============================================================
begin;

-- ล้างของเดิม — ครอบ id + เลขที่
delete from je_lines where je_id in (
  select id from journal_entries
   where source_id = 'ffffffff-0050-4000-8000-000000000050'
      or je_number = 'JE-DEMO-LG50-ISSUE');
delete from journal_entries
 where source_id = 'ffffffff-0050-4000-8000-000000000050'
    or je_number = 'JE-DEMO-LG50-ISSUE';
delete from letter_guarantees
 where lg_no = 'LG-DEMO-TERM-050'
    or id = 'ffffffff-0050-4000-8000-000000000050';

-- LG (Active) · Expense Mode (prepaid = false) · Fee 90,000 (รับรู้เป็นค่าใช้จ่ายเต็มจำนวนแล้ว)
insert into letter_guarantees
  (id, lg_no, name, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status, prepaid, rate_cards, fee_amount)
values
  ('ffffffff-0050-4000-8000-000000000050',
   'LG-DEMO-TERM-050', 'LG-TERM50', 'LG', 'BBL',
   'บริษัท ผู้รับประโยชน์ทดสอบ จำกัด', 'ค้ำประกันสัญญาทดสอบยกเลิกแบบ Expense',
   6000000, 'THB', current_date - 120, current_date + 245, 'Active',
   false,
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":null}]'::jsonb, 90000);

-- ใบสำคัญภาระผูกพันนอกงบตอนออก (Posted) — ให้ตอนยกเลิกมีตัวกลับรายการ
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('ffffffff-0050-4000-8000-0000000000e1',
   'JE-DEMO-LG50-ISSUE', 'LG_ISSUE_OFFBALANCE', 'ffffffff-0050-4000-8000-000000000050',
   current_date - 120, 'LG-DEMO-TERM-050 — Issue Off-Balance',
   6000000, 6000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('ffffffff-0050-4000-8000-0000000000e1', 1, '900100', 'Contingent Liability — LG/BG (Off-Balance)', 6000000, 0, 'LG/BG commitment (off-balance)'),
  ('ffffffff-0050-4000-8000-0000000000e1', 2, '900200', 'Contra — LG/BG Commitment', 0, 6000000, 'Contra — off-balance');

commit;

-- ตรวจ: LG-DEMO-TERM-050 → Actions → ⚠️ Terminate B/G, L/G
--   กล่อง Pro-rata Refund = "Expense Mode — ไม่มี Refund (recognize เต็มจำนวนแล้ว)"
