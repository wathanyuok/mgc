-- ============================================================
-- Seed: OD-43 — ข้อมูลธนาคารหยุดกลางเดือน ต้องคิดดอกเบี้ยถึงวันสุดท้ายที่มีข้อมูลเท่านั้น
--
--   • MA-OD43 / CA-OD43 (วงเงิน OD 2,000,000)
--   • OD-OD43 (Active) · account_no = 1403024643 · วงเงิน 2,000,000 · อัตรา 6%
--   • Bank Statement (Active) · มีรายการ "ถึงวันที่ 10 เท่านั้น" (01/08, 05/08, 10/08) · ไม่มี 11–31
--       01/08 balance -1,000,000
--       05/08 balance -1,200,000
--       10/08 balance -800,000   ← แถวสุดท้าย คิด 1 วัน (ไม่ลากถึงสิ้นเดือน)
--
-- การคิดของระบบ (od-schedule.ts):
--   แถว 01/08 → ถึง 05/08 = 4 วัน · แถว 05/08 → ถึง 10/08 = 5 วัน · แถว 10/08 (สุดท้าย) = 1 วัน
--   ไม่มีดอกเบี้ยวันที่ 11–31 (ไม่มีข้อมูลธนาคาร)
--
-- วิธีทดสอบ OD-43:
--   1. เปิด OD-OD43 → แท็บ Schedule Calculate → Daily Transaction
--   2. ดูแถวสุดท้าย = 10/08/2026 · DAYS = 1 (ไม่ใช่ 22 วันลากถึง 31)
--   ผล: คิดดอกเบี้ยถึงวันที่ 10 เท่านั้น · แถวสุดท้าย 1 วัน
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from bank_statement_lines where statement_id = 'd9d9e240-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e240-0000-0000-0000-0000000000f1'
   or (account_no = '1403024643' and statement_name like 'BBL OD43 Statement%');
delete from overdrafts where id = 'd9d9e240-0000-0000-0000-0000000000a1' or od_no = 'OD-OD43';
delete from credit_agreements where id = 'd9d9e240-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD43-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e240-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e240-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD43-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e240-0000-0000-0000-0000000000c2','BBL','MA-OD43-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e240-0000-0000-0000-0000000000c2','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e240-0000-0000-0000-0000000000c1','d9d9e240-0000-0000-0000-0000000000c2',
   'CA-OD43-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD43-DEMO', 'MGC',
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
  ('d9d9e240-0000-0000-0000-0000000000a1','OD-OD43','OD-OD43',
   'd9d9e240-0000-0000-0000-0000000000c1','BBL', 2000000, 2000000, 800000,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024643',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-43 · ใบแจ้งยอดมีถึงวันที่ 10 เท่านั้น ไว้ทดสอบแถวสุดท้ายคิด 1 วัน', now(), now());

-- ④ Bank Statement (Active) — รายการถึงวันที่ 10 เท่านั้น (ไม่มี 11–31)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e240-0000-0000-0000-0000000000f1','BBL','1403024643','BBL OD43 Statement','2026-08','Manual', false,
   'seed OD-43 · ข้อมูลหยุดวันที่ 10', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e240-0000-0000-0000-0000000000e1','d9d9e240-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD', 1000000, 0, -1000000, 'Manual','day 1', 0),
  ('d9d9e240-0000-0000-0000-0000000000e2','d9d9e240-0000-0000-0000-0000000000f1', date '2026-08-05','11:00','TRANSFER','เบิกเพิ่ม', 200000, 0, -1200000, 'Manual','day 5', 1),
  ('d9d9e240-0000-0000-0000-0000000000e3','d9d9e240-0000-0000-0000-0000000000f1', date '2026-08-10','14:00','ENET','รับเงินเข้า (รายการสุดท้าย)', 0, 400000, -800000, 'Manual','day 10 = last', 2);

-- ⑤ ตรวจผล
select bs.statement_name,
       (select max(l.tx_date) from bank_statement_lines l where l.statement_id=bs.id) as last_tx_date,
       (select count(*) from bank_statement_lines l where l.statement_id=bs.id) as line_count
  from bank_statements bs where bs.id='d9d9e240-0000-0000-0000-0000000000f1';
-- คาดหวัง: last_tx_date = 2026-08-10 · line_count = 3
--   → Daily Transaction แถวสุดท้าย = 10/08 · DAYS = 1 · ไม่มีดอกเบี้ยวันที่ 11–31
