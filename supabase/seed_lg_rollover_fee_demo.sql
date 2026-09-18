-- ============================================================
-- Seed: LG-46 — ค่าธรรมเนียมฉบับต่ออายุ = ยอดใหม่ที่คำนวณตอนต่ออายุ
-- LG (Active) · วงเงิน (AMOUNT THB) 8,000,000 · Fee Rate (annual) 2% ต่อปี
--   → Fee งวดใหม่ = 8,000,000 × 2% = 160,000
--
-- ทดสอบ: เปิด LG-DEMO-FEE-046 → กดปุ่ม "Roll Over" → กรอก Expiry Date ใหม่
--   หน้าต่างต่ออายุจะโชว์บรรทัด "Fee งวดใหม่ (2.00%/ปี) = 160,000.00 THB"
--   ยืนยัน → เปิดฉบับใหม่ที่เพิ่งได้ → แท็บ Fee → ช่อง AMOUNT = 160,000 (ไม่ใช่ยอดเดิม)
-- ============================================================
begin;

-- ล้างของเดิม — ครอบ id + เลขที่ (รวมฉบับ -RO1 ถ้าเคยกดทดสอบไปแล้ว)
delete from je_lines where je_id in (
  select id from journal_entries
   where source_id = 'eeeeeeee-0046-4000-8000-000000000046'
      or je_number = 'JE-DEMO-LG46-ISSUE');
delete from journal_entries
 where source_id = 'eeeeeeee-0046-4000-8000-000000000046'
    or je_number = 'JE-DEMO-LG46-ISSUE';
delete from letter_guarantees
 where lg_no in ('LG-DEMO-FEE-046', 'LG-DEMO-FEE-046-RO1')
    or id = 'eeeeeeee-0046-4000-8000-000000000046';

-- LG (Active) · วงเงิน 8,000,000 · Fee Rate 2%/ปี
insert into letter_guarantees
  (id, lg_no, name, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status, rate_cards, fee_amount)
values
  ('eeeeeeee-0046-4000-8000-000000000046',
   'LG-DEMO-FEE-046', 'LG-FEE46', 'LG', 'BBL',
   'บริษัท ผู้รับประโยชน์ทดสอบ จำกัด', 'ค้ำประกันสัญญาทดสอบค่าธรรมเนียมฉบับต่ออายุ',
   8000000, 'THB', current_date - 180, current_date + 185, 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":2,"condition":0,"start_date":null}]'::jsonb, 160000);

-- ใบสำคัญภาระผูกพันนอกงบตอนออก (Posted) — ให้ตอนต่ออายุมีตัวกลับรายการ
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('eeeeeeee-0046-4000-8000-0000000000e1',
   'JE-DEMO-LG46-ISSUE', 'LG_ISSUE_OFFBALANCE', 'eeeeeeee-0046-4000-8000-000000000046',
   current_date - 180, 'LG-DEMO-FEE-046 — Issue Off-Balance',
   8000000, 8000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('eeeeeeee-0046-4000-8000-0000000000e1', 1, '900100', 'Contingent Liability — LG/BG (Off-Balance)', 8000000, 0, 'LG/BG commitment (off-balance)'),
  ('eeeeeeee-0046-4000-8000-0000000000e1', 2, '900200', 'Contra — LG/BG Commitment', 0, 8000000, 'Contra — off-balance');

commit;

-- ตรวจ: LG-DEMO-FEE-046 → Roll Over → "Fee งวดใหม่ (2.00%/ปี) = 160,000"
--   → ฉบับใหม่ แท็บ Fee ช่อง AMOUNT = 160,000
