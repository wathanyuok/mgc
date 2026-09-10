-- Seed: PN demo สำหรับทดสอบ PN-61 (สถานะ Repaid — เทียบกับสถานะที่ปิดแล้ว)
-- (แยกใบจาก PN-57 เพื่อไม่ให้ทดสอบชนกัน)
--
-- สร้าง:
--   1) ตั๋ว PN-DEMO-REPAID-061 สถานะ Repaid · 1,000,000 · 5% · 01/01/2026 → 01/04/2026
--   2) ใบสำคัญ Drawdown (Posted) ผูกไว้ → ปุ่มลงบัญชีดอกเบี้ยรายงวด "เปิด" ให้กดย้อนหลังได้
--
-- ทดสอบ: เปิด PN-DEMO-REPAID-061
--   - หัวหน้าจอ: แถบสีเขียว "✅ ชำระคืนครบแล้ว (P/N Repaid)"
--   - ลองพิมพ์แก้ช่องกรอก (เช่น REMARK) → แก้ได้
--   - แท็บ Schedule Calculate → คอลัมน์ JE → งวดที่ยังไม่ลง มีลิงก์ "ลงบัญชี" กดได้
--   - เทียบกับ PN-DEMO-CANCELLED-060: แถบเทา · ทุกช่องล็อก · Post JE ไม่ได้
--
-- รันซ้ำได้ (ลบใบสำคัญ + ตั๋วเดิมก่อน)

delete from je_lines where je_id in (
  select id from journal_entries where je_number = 'JE-DEMO-PN61-0001'
);
delete from journal_entries where je_number = 'JE-DEMO-PN61-0001';
delete from promissory_notes where pn_number = 'PN-DEMO-REPAID-061';

-- 1) ตั๋วสถานะ Repaid
insert into promissory_notes
  (id, name, pn_number, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rate_cards)
values
  ('11111111-0000-0000-0000-000000000061',
   'PN-DEMO-REPAID-061', 'PN-DEMO-REPAID-061',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-01-01', '2026-04-01', 90, 1000000, 'THB', 'Repaid',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb);

-- 2) ใบสำคัญ Drawdown (Posted)
insert into journal_entries
  (id, je_number, source_type, source_id, je_date, description,
   total_dr, total_cr, status, posted_by, posted_at, is_reversal)
values
  ('11111111-0000-0000-0000-0000000000d0',
   'JE-DEMO-PN61-0001', 'PN_DRAWDOWN', '11111111-0000-0000-0000-000000000061',
   '2026-01-01', 'PN-DEMO-REPAID-061 — P/N Drawdown (เบิกใช้วงเงิน)',
   1000000, 1000000, 'Posted', 'seed', now(), false);

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('11111111-0000-0000-0000-0000000000d0', 1, '1001201', 'เงินฝากธนาคาร-กระแสรายวัน BBL', 1000000, 0, 'Cash received from P/N drawdown'),
  ('11111111-0000-0000-0000-0000000000d0', 2, '2142101', 'เงินกู้ยืมระยะสั้น-สถาบันการเงิน', 0, 1000000, 'Note Payable — P/N principal');
