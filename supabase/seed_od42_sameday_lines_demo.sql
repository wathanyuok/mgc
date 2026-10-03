-- ============================================================
-- Seed: OD-42 — หลายรายการในวันเดียวกัน ต้องคิดดอกเบี้ย 1 วัน จากยอดสิ้นวัน
--
--   • MA-OD42 / CA-OD42 (วงเงิน OD 2,000,000)
--   • OD-OD42 (Active) · account_no = 1403024642 · วงเงิน 2,000,000 · อัตรา 6%
--   • Bank Statement (Active) · 5 บรรทัด วันเดียวกัน (01/08/2026) · ยอดสิ้นวัน = -700,000
--       10:00 เบิก 500,000        → balance -500,000
--       11:00 เบิก 300,000        → balance -800,000
--       13:00 รับเข้า 200,000     → balance -600,000
--       14:00 เบิก 300,000        → balance -900,000
--       16:00 รับเข้า 200,000     → balance -700,000  ← ยอดสิ้นวัน (ใช้คิดดอกเบี้ย)
--
-- การคิดของระบบ (od-schedule.ts · ยุบรายวัน): 01/08 เหลือแถวเดียว · ยอดสิ้นวัน -700,000 · 1 วัน
--   ดอกเบี้ย = 700,000 × 6% / 365 × 1 = 115.07  (ไม่ใช่คูณ 5 เท่าตามจำนวนบรรทัด)
--
-- วิธีทดสอบ OD-42:
--   1. เปิด OD-OD42 → แท็บ Schedule Calculate → Daily Transaction
--   2. ดูวันที่ 01/08/2026 → แสดง "แถวเดียว" · ENDING BALANCE -700,000 · DAYS 1
--   ผล: คิดดอกเบี้ย 1 วันจากยอดสิ้นวัน (-700,000) ไม่ใช่ 5 แถว 5 วัน
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from bank_statement_lines where statement_id = 'd9d9e230-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e230-0000-0000-0000-0000000000f1'
   or (account_no = '1403024642' and statement_name like 'BBL OD42 Statement%');
delete from overdrafts where id = 'd9d9e230-0000-0000-0000-0000000000a1' or od_no = 'OD-OD42';
delete from credit_agreements where id = 'd9d9e230-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD42-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e230-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e230-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD42-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e230-0000-0000-0000-0000000000c2','BBL','MA-OD42-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e230-0000-0000-0000-0000000000c2','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e230-0000-0000-0000-0000000000c1','d9d9e230-0000-0000-0000-0000000000c2',
   'CA-OD42-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD42-DEMO', 'MGC',
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
  ('d9d9e230-0000-0000-0000-0000000000a1','OD-OD42','OD-OD42',
   'd9d9e230-0000-0000-0000-0000000000c1','BBL', 2000000, 2000000, 700000,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024642',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-42 · 5 รายการวันเดียวกัน ไว้ทดสอบคิดดอกเบี้ย 1 วันจากยอดสิ้นวัน', now(), now());

-- ④ Bank Statement (Active) — 5 บรรทัด วันเดียวกัน 01/08/2026
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e230-0000-0000-0000-0000000000f1','BBL','1403024642','BBL OD42 Statement','2026-08','Manual', false,
   'seed OD-42 · 5 รายการวันเดียว', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e230-0000-0000-0000-0000000000e1','d9d9e230-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิก #1', 500000, 0, -500000, 'Manual','same-day 1', 0),
  ('d9d9e230-0000-0000-0000-0000000000e2','d9d9e230-0000-0000-0000-0000000000f1', date '2026-08-01','11:00','TRANSFER','เบิก #2', 300000, 0, -800000, 'Manual','same-day 2', 1),
  ('d9d9e230-0000-0000-0000-0000000000e3','d9d9e230-0000-0000-0000-0000000000f1', date '2026-08-01','13:00','ENET','รับเข้า #3', 0, 200000, -600000, 'Manual','same-day 3', 2),
  ('d9d9e230-0000-0000-0000-0000000000e4','d9d9e230-0000-0000-0000-0000000000f1', date '2026-08-01','14:00','TRANSFER','เบิก #4', 300000, 0, -900000, 'Manual','same-day 4', 3),
  ('d9d9e230-0000-0000-0000-0000000000e5','d9d9e230-0000-0000-0000-0000000000f1', date '2026-08-01','16:00','ENET','รับเข้า #5 (ยอดสิ้นวัน)', 0, 200000, -700000, 'Manual','same-day 5 = EOD', 4);

-- ⑤ ตรวจผล
select bs.statement_name,
       (select count(*) from bank_statement_lines l where l.statement_id=bs.id and l.tx_date=date '2026-08-01') as lines_on_0801,
       (select l.balance from bank_statement_lines l where l.statement_id=bs.id and l.tx_date=date '2026-08-01' order by l.sort_order desc limit 1) as eod_balance_0801
  from bank_statements bs where bs.id='d9d9e230-0000-0000-0000-0000000000f1';
-- คาดหวัง: lines_on_0801 = 5 · eod_balance_0801 = -700,000
--   → Daily Transaction วันที่ 01/08 เหลือแถวเดียว ยอด -700,000 คิด 1 วัน (ดอกเบี้ย 700,000×6%/365 = 115.07)
