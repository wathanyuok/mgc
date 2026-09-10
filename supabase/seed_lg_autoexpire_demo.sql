-- Seed: LG/BG demo สำหรับทดสอบ LG-08 (หมดอายุอัตโนมัติเมื่อเลยวันหมดอายุ)
--
-- สร้างสภาพ "ค้าง": สถานะ Active + วันหมดอายุเป็นเมื่อวาน (current_date - 1)
--   → ยังไม่ถูกเปลี่ยนเป็น Expired เพราะยังไม่มีใครเปิดหน้ารายการไปกระตุ้น
-- พร้อมใบสำคัญภาระผูกพันนอกงบตอนออก (Dr 900100 Contingent / Cr 900200 Contra)
--
-- ทดสอบ: เปิดหน้ารายการ LG/BG (ถ้าเปิดค้างไว้อยู่แล้ว กดโหลดใหม่ที่เบราว์เซอร์)
--   ผล: LG-DEMO-EXPIRE-008 → สถานะเปลี่ยนเป็น Expired อัตโนมัติ
--       + เกิดใบสำคัญกลับรายการนอกงบ (Dr 900200 / Cr 900100) ยอด 5,000,000
--       พร้อมเหตุผล "ครบกำหนด (วันสิ้นสุด <เมื่อวาน>)"
--
-- รันซ้ำได้ (ลบใบสำคัญ + LG เดิมก่อน)
-- หมายเหตุ: ถ้าเทสไปแล้ว LG กลายเป็น Expired — รันไฟล์นี้ใหม่จะรีเซ็ตกลับเป็น Active ให้

delete from je_lines where je_id in (
  select id from journal_entries where je_number in ('JE-DEMO-LG08-ISSUE')
);
delete from journal_entries
  where source_id = '22222222-0000-0000-0000-000000000008'
     or je_number = 'JE-DEMO-LG08-ISSUE';
delete from letter_guarantees where lg_no = 'LG-DEMO-EXPIRE-008';

-- 1) LG/BG สถานะ Active · วันหมดอายุ = เมื่อวาน
insert into letter_guarantees
  (id, lg_no, lg_type, finance_institution, beneficiary, subject,
   amount, currency, issue_date, expiry_date, status)
values
  ('22222222-0000-0000-0000-000000000008',
   'LG-DEMO-EXPIRE-008', 'LG', 'BBL', 'บริษัท ทดสอบผู้รับประโยชน์ จำกัด',
   'ค้ำประกันสัญญาทดสอบ auto-expire',
   5000000, 'THB', current_date - 100, current_date - 1, 'Active');

-- 2) ใบสำคัญภาระผูกพันนอกงบตอนออก (Posted)
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('22222222-0000-0000-0000-0000000000e0',
   'JE-DEMO-LG08-ISSUE', 'LG_ISSUE_OFFBALANCE', '22222222-0000-0000-0000-000000000008',
   current_date - 100, 'LG-DEMO-EXPIRE-008 — Issue Off-Balance',
   5000000, 5000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('22222222-0000-0000-0000-0000000000e0', 1, '900100', 'Contingent Liability — LG/BG (Off-Balance)', 5000000, 0, 'LG/BG commitment (off-balance)'),
  ('22222222-0000-0000-0000-0000000000e0', 2, '900200', 'Contra — LG/BG Commitment', 0, 5000000, 'Contra — off-balance');
