-- ============================================================
-- Seed: O/D — ลงบัญชีดอกเบี้ยรายเดือน (ปุ่ม "ลงบัญชีเดือนนี้")
-- O/D (Active) ผูกบัญชี 181-3-55501-0 · ดอกเบี้ย 7% · วงเงิน 500,000
-- + ใบแจ้งยอดธนาคารงวด พ.ค. 2026 ที่ยอดคงเหลือติดลบ (เบิกเกินบัญชี)
-- → เกิดดอกเบี้ยรายวัน → เดือน พ.ค. มีปุ่ม "📋 ลงบัญชีเดือนนี้"
--
-- ทดสอบ: เปิด OD-DEMO-INT → แท็บ Schedule Calculate → ซับแท็บ Summary Transaction
--   → เดือน พ.ค. 2026 กด "📋 ลงบัญชีเดือนนี้"
--   ได้ใบสำคัญ: Dr ดอกเบี้ยจ่าย-Bank Overdraft / Cr Bank + reclass ยอดเบิกเกินเป็นหนี้สิน
-- ============================================================
begin;

-- ล้างของเดิม (ครอบ id + account_no กันชน)
delete from bank_statement_lines
 where statement_id in (select id from bank_statements where account_no = '181-3-55501-0');
delete from bank_statements where account_no = '181-3-55501-0';
delete from overdrafts
 where od_no = 'OD-DEMO-INT' or id = '33333333-3333-3333-3333-33333333e017';

-- O/D (Active) · ดอกเบี้ย 7%
insert into overdrafts
  (id, od_no, name, finance_institution, account_no, facility_limit, used_amount,
   start_date, transaction_date, amount, currency, status, rate_cards)
values
  ('33333333-3333-3333-3333-33333333e017', 'OD-DEMO-INT', 'OD-DEMO-INT',
   'BBL', '181-3-55501-0', 500000, 250000,
   date '2026-05-01', date '2026-05-01', 500000, 'THB', 'Active',
   '[{"id":"bbbbbbbb-0000-0000-0000-0000000e0017","type":"MOR","rate":7,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- ใบแจ้งยอดธนาคาร งวด พ.ค. 2026 (บัญชีเดียวกับ O/D)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive)
values
  ('44444444-4444-4444-4444-44444444e017', 'BBL', '181-3-55501-0',
   'BBL พ.ค. 2026 (O/D Demo)', '2026-05', 'Manual', false);

-- รายการเดินบัญชี — ยอดคงเหลือลงไปติดลบระหว่างเดือน (เบิกเกินบัญชี)
insert into bank_statement_lines
  (statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, sort_order)
values
  ('44444444-4444-4444-4444-44444444e017', date '2026-05-01', '09:00', 'ENET', 'ยอดยกมา / รับโอน',            0, 100000,  100000, 'Manual', 0),
  ('44444444-4444-4444-4444-44444444e017', date '2026-05-10', '11:20', 'ENET', 'ถอน/จ่ายซัพพลายเออร์',  300000,      0, -200000, 'Manual', 1),
  ('44444444-4444-4444-4444-44444444e017', date '2026-05-20', '15:45', 'ENET', 'ถอนเพิ่ม (เบิกเกินบัญชี)', 50000,     0, -250000, 'Manual', 2),
  ('44444444-4444-4444-4444-44444444e017', date '2026-05-31', '23:59', 'ENET', 'ยอดสิ้นเดือน',                 0,      0, -250000, 'Manual', 3);

commit;

-- ตรวจ: เปิด OD-DEMO-INT → แท็บ Schedule Calculate → ซับแท็บ Summary Transaction
--   เดือน พ.ค. 2026 จะมีดอกเบี้ยเดินอยู่ (ยอดติดลบ) → กด "📋 ลงบัญชีเดือนนี้"
--   ถ้าไม่เห็นปุ่ม เช็คว่า Account No ตรง = 181-3-55501-0 และใบแจ้งยอดไม่ inactive
