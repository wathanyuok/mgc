-- ============================================================
-- Seed: LG-51 (ตัวอย่าง A) — ยกเลิกสำเร็จ แบบ Prepaid (มีเงินคืน)
-- LG อยู่สถานะ Pending Termination (Maker ขอยกเลิกไว้แล้ว) → รอ Approver กดอนุมัติ
--
-- ค่าตั้งต้นตรงกับตัวอย่าง:
--   วงเงิน 6,000,000 · Prepaid · Fee 90,000 (1.5%)
--   Issue 01/01/2026 → Expiry 31/12/2026 (364 วัน)
--   คำขอยกเลิก: Notification 30/06/2026 · Lead 30 วัน → Effective Cancel 30/07/2026
--   Days Remaining 154 → Refund = 90,000 × 154/364 = 38,076.92
--
-- ทดสอบ (ต้องล็อกอินเป็นคน ≠ 'maker' เพราะคนขอยกเลิกอนุมัติเองไม่ได้):
--   เปิด LG-2569-0012 → เห็นแถบ "⏳ รอการอนุมัติยกเลิก" → กด "อนุมัติการยกเลิก"
--   ผล: STATUS → Terminated
--        + ใบสำคัญคืนเงิน  "LG-2569-0012 — Early Termination Refund" (Dr Cash / Cr Prepaid 38,076.92)
--        + ใบสำคัญกลับรายการนอกงบ "LG-2569-0012 — กลับรายการภาระผูกพันนอกงบ (ยกเลิกก่อนกำหนด (มีผล 2026-07-30))"
--        + REMARK ถูกเติมสรุปการยกเลิก
-- ============================================================
begin;

-- ล้างของเดิม — ครอบ id + เลขที่ (รวมใบสำคัญที่อาจเกิดจากการกดทดสอบไปแล้ว)
delete from je_lines where je_id in (
  select id from journal_entries where source_id = '11111111-0051-4000-8000-000000000051');
delete from journal_entries where source_id = '11111111-0051-4000-8000-000000000051';
delete from letter_guarantees
 where lg_no = 'LG-2569-0012'
    or id = '11111111-0051-4000-8000-000000000051';

-- LG (Prepaid) · สถานะ Pending Termination + พารามิเตอร์คำขอยกเลิกที่ Maker กรอกไว้
insert into letter_guarantees
  (id, lg_no, name, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status, prepaid, rate_cards, fee_amount,
   termination_requested_by, termination_requested_at,
   termination_notification_date, termination_lead_time_days, termination_refund_schedule)
values
  ('11111111-0051-4000-8000-000000000051',
   'LG-2569-0012', 'LG-2569-0012', 'LG', 'BBL',
   'การไฟฟ้าส่วนภูมิภาค', 'ค้ำประกันสัญญาทดสอบยกเลิกแบบมีเงินคืน',
   6000000, 'THB', '2026-01-01', '2026-12-31', 'Pending Termination', true,
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":null}]'::jsonb, 90000,
   'maker', now() - interval '1 day',
   '2026-06-30', 30, 'One-time');

-- ใบสำคัญภาระผูกพันนอกงบตอนออก (Posted) — ให้ตอนอนุมัติยกเลิกมีตัวกลับรายการ
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('11111111-0051-4000-8000-0000000000e1',
   'JE-DEMO-LG51-ISSUE', 'LG_ISSUE_OFFBALANCE', '11111111-0051-4000-8000-000000000051',
   '2026-01-01', 'LG-2569-0012 — Issue Off-Balance',
   6000000, 6000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('11111111-0051-4000-8000-0000000000e1', 1, '900100', 'Contingent Liability — LG/BG (Off-Balance)', 6000000, 0, 'LG/BG commitment (off-balance)'),
  ('11111111-0051-4000-8000-0000000000e1', 2, '900200', 'Contra — LG/BG Commitment', 0, 6000000, 'Contra — off-balance');

commit;

-- ตรวจ: เปิด LG-2569-0012 (ล็อกอิน ≠ maker) → แถบ "⏳ รอการอนุมัติยกเลิก"
--   โชว์ วันมีผล 2026-07-30 · เงินคืนโดยประมาณ 38,076.92
--   → กด "อนุมัติการยกเลิก" → เกิดใบสำคัญ 2 ใบ + STATUS Terminated + REMARK
