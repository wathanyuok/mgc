-- ============================================================
-- Seed: LG-45 — ต่ออายุ (Roll Over) ครั้งที่ 2 · เลขอ้างอิงต้องได้ -RO2 (ไม่ซ้อน -RO-RO)
--
-- สร้างสายต่ออายุ:
--   ฉบับเดิม  LG-DEMO-RO-045      (status Roll Over — ถูกต่อไปแล้ว)
--   ฉบับ RO1  LG-DEMO-RO-045-RO1  (status Active — พร้อมกดต่อครั้งที่ 2)
--
-- ทดสอบ: เปิด LG-DEMO-RO-045-RO1 → กดปุ่ม "Roll Over" → กรอก Expiry Date ใหม่ → ยืนยัน
--   ผล: ได้ฉบับใหม่ lg_no = LG-DEMO-RO-045-RO2 (regex ตัด base = LG-DEMO-RO-045 แล้ว +1)
--       name เป็นเลข running ใหม่ · สถานะ Draft · ผูก rollover_parent_id กับ RO1
--       ฉบับ RO1 เปลี่ยนเป็นสถานะ Roll Over
-- ============================================================
begin;

-- ล้างของเดิม — ครอบ id + เลขที่ (รวมฉบับ RO2 ถ้าเคยกดทดสอบไปแล้ว)
delete from je_lines where je_id in (
  select id from journal_entries where source_id in (
    'dddddddd-0045-4000-8000-000000000001',
    'dddddddd-0045-4000-8000-000000000045'));
delete from journal_entries where source_id in (
  'dddddddd-0045-4000-8000-000000000001',
  'dddddddd-0045-4000-8000-000000000045');
delete from letter_guarantees
 where lg_no in ('LG-DEMO-RO-045', 'LG-DEMO-RO-045-RO1', 'LG-DEMO-RO-045-RO2')
    or id in ('dddddddd-0045-4000-8000-000000000001',
              'dddddddd-0045-4000-8000-000000000045');

-- 1) ฉบับเดิม (ถูกต่ออายุไปแล้ว → Roll Over)
insert into letter_guarantees
  (id, lg_no, name, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status, rate_cards, fee_amount)
values
  ('dddddddd-0045-4000-8000-000000000001',
   'LG-DEMO-RO-045', 'LG-RO45-ORIG', 'LG', 'BBL',
   'บริษัท ผู้รับประโยชน์ทดสอบ จำกัด', 'ค้ำประกันสัญญาทดสอบต่ออายุครั้งที่ 2',
   5000000, 'THB', current_date - 400, current_date - 200, 'Roll Over',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":null}]'::jsonb, 75000);

-- 2) ฉบับ RO1 (Active — พร้อมกดต่อครั้งที่ 2)
insert into letter_guarantees
  (id, lg_no, name, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status,
   rate_cards, fee_amount, rollover_parent_id, reference_contract, payment_date)
values
  ('dddddddd-0045-4000-8000-000000000045',
   'LG-DEMO-RO-045-RO1', 'LG-RO45-RO1', 'LG', 'BBL',
   'บริษัท ผู้รับประโยชน์ทดสอบ จำกัด', 'ค้ำประกันสัญญาทดสอบต่ออายุครั้งที่ 2',
   5000000, 'THB', current_date - 200, current_date + 165, 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":null}]'::jsonb, 75000,
   'dddddddd-0045-4000-8000-000000000001', 'LG-RO45-ORIG', current_date - 200);

-- 3) ใบสำคัญภาระผูกพันนอกงบของ RO1 (Posted) — เพื่อให้ตอนต่ออายุมีตัวให้กลับรายการ
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('dddddddd-0045-4000-8000-0000000000e1',
   'JE-DEMO-LG45-ISSUE', 'LG_ISSUE_OFFBALANCE', 'dddddddd-0045-4000-8000-000000000045',
   current_date - 200, 'LG-DEMO-RO-045-RO1 — Issue Off-Balance',
   5000000, 5000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('dddddddd-0045-4000-8000-0000000000e1', 1, '900100', 'Contingent Liability — LG/BG (Off-Balance)', 5000000, 0, 'LG/BG commitment (off-balance)'),
  ('dddddddd-0045-4000-8000-0000000000e1', 2, '900200', 'Contra — LG/BG Commitment', 0, 5000000, 'Contra — off-balance');

commit;

-- ตรวจ: เปิด LG-DEMO-RO-045-RO1 → ปุ่ม Roll Over → กรอก Expiry ใหม่ → ยืนยัน
--   ฉบับใหม่ต้องได้ lg_no = LG-DEMO-RO-045-RO2 (ไม่ใช่ ...-RO1-RO / -RO-RO)
