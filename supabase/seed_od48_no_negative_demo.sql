-- ============================================================
-- Seed: OD-48 — เดือนที่ยอดคงเหลือไม่ติดลบเลย → ดอกเบี้ย 0 → ปุ่มลงบัญชีเดือนนั้นกดไม่ได้
--
--   • MA-OD48 / CA-OD48 (วงเงิน OD 2,000,000)
--   • OD-OD48 (Active) · account_no = 1403024648 · วงเงิน 2,000,000 · อัตรา 6%
--   • Bank Statement (Active) · ส.ค. 2026 · ทุกบรรทัด balance "เป็นบวก" (ไม่ติดลบเลย)
--       01/08 balance +500,000
--       15/08 balance +800,000
--       31/08 balance +300,000
--     → ไม่มีวันไหนใช้ OD → ดอกเบี้ยเดือน ส.ค. = 0
--
-- วิธีทดสอบ OD-48:
--   1. เปิด OD-OD48 → แท็บ Schedule Calculate → Summary Transaction
--   2. หาแถวเดือน ส.ค. 2026 → INTEREST = 0.00 · ดูปุ่ม "ลงบัญชีเดือนนี้"
--   3. hover ปุ่ม
--   ผล: ปุ่มเทา กดไม่ได้ · tooltip "ดอกเบี้ยเดือนนี้เป็น 0 (ยอดคงเหลือไม่ติดลบ) — ไม่มีอะไรให้ลงบัญชี"
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from bank_statement_lines where statement_id = 'd9d9e250-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e250-0000-0000-0000-0000000000f1'
   or (account_no = '1403024648' and statement_name like 'BBL OD48 Statement%');
delete from overdrafts where id = 'd9d9e250-0000-0000-0000-0000000000a1' or od_no = 'OD-OD48';
delete from credit_agreements where id = 'd9d9e250-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD48-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e250-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e250-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD48-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e250-0000-0000-0000-0000000000c2','BBL','MA-OD48-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e250-0000-0000-0000-0000000000c2','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e250-0000-0000-0000-0000000000c1','d9d9e250-0000-0000-0000-0000000000c2',
   'CA-OD48-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD48-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   2000000, 'THB', 'Revolving', 'BBL',
   date '2026-06-01', date '2027-05-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ OD (Active) — FIELD ครบ
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('d9d9e250-0000-0000-0000-0000000000a1','OD-OD48','OD-OD48',
   'd9d9e250-0000-0000-0000-0000000000c1','BBL', 2000000, 2000000, 0,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024648',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-48 · ยอดบวกตลอดเดือน (ดอกเบี้ย 0) ไว้ทดสอบปุ่มลงบัญชีกดไม่ได้', now(), now());

-- ④ Bank Statement (Active) — ยอดเป็นบวกทุกบรรทัด (ไม่ติดลบ → ไม่ใช้ OD → ดอกเบี้ย 0)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e250-0000-0000-0000-0000000000f1','BBL','1403024648','BBL OD48 Statement','2026-08','Manual', false,
   'seed OD-48 · ยอดบวกตลอด ไม่ติดลบ', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e250-0000-0000-0000-0000000000e1','d9d9e250-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','ENET','เงินเข้า', 0, 500000, 500000, 'Manual','positive 1', 0),
  ('d9d9e250-0000-0000-0000-0000000000e2','d9d9e250-0000-0000-0000-0000000000f1', date '2026-08-15','11:00','ENET','เงินเข้าเพิ่ม', 0, 300000, 800000, 'Manual','positive 2', 1),
  ('d9d9e250-0000-0000-0000-0000000000e3','d9d9e250-0000-0000-0000-0000000000f1', date '2026-08-31','14:00','TRANSFER','จ่ายออก (ยังเหลือบวก)', 500000, 0, 300000, 'Manual','positive 3', 2);

-- ⑤ ตรวจผล
select bs.statement_name,
       (select count(*) from bank_statement_lines l where l.statement_id=bs.id and l.balance < 0) as negative_lines,
       (select min(l.balance) from bank_statement_lines l where l.statement_id=bs.id) as min_balance
  from bank_statements bs where bs.id='d9d9e250-0000-0000-0000-0000000000f1';
-- คาดหวัง: negative_lines = 0 · min_balance = 300,000 (ไม่ติดลบเลย)
--   → เดือน ส.ค. ดอกเบี้ย 0 → ปุ่ม "ลงบัญชีเดือนนี้" กดไม่ได้ + tooltip "ดอกเบี้ยเดือนนี้เป็น 0..."
