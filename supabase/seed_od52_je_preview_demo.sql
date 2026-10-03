-- ============================================================
-- Seed: OD-52 — ตัวอย่างใบสำคัญ (JE Preview) ต้องตรงกับใบที่ลงจริงของเดือนนั้น
--
--   • MA-OD52 / CA-OD52 (วงเงิน OD 2,000,000)
--   • OD-OD52 (Active) · account_no = 1403024652 · วงเงิน 2,000,000 · อัตรา 6%
--   • Bank Statement (Active) · ส.ค. 2026 · balance -1,200,000 (ใช้ OD → มีดอกเบี้ย)
--     *** ยังไม่ลงบัญชี (ไม่มี JE OD_ACCRUED) *** เพื่อให้ดู JE Preview ก่อน แล้วค่อยลงจริงเทียบ
--
-- วิธีทดสอบ OD-52:
--   1. เปิด OD-OD52 → แท็บ Schedule Calculate → Daily Transaction
--      → ดูกล่อง "📋 ตัวอย่างใบสำคัญ — เดือน Aug 2026" (ขวามือ)
--      จด: JV-Interest (Dr/Cr = ดอกเบี้ยรวม) · JV-Bank Overdraft (Dr/Cr = |ยอดสิ้น − ดอกเบี้ย|)
--   2. แท็บ Summary Transaction → กด "ลงบัญชีเดือนนี้" (Aug 2026)
--   3. เปิดใบสำคัญที่เกิด → เทียบตัวเลขกับ preview
--   ผล: ทุกบรรทัดตรงกัน (มาจาก monthSummary ชุดเดียว · สูตร endingBalance − totalInterest)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type='OD_ACCRUED' and source_id='d9d9e270-0000-0000-0000-0000000000a1';
delete from bank_statement_lines where statement_id = 'd9d9e270-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e270-0000-0000-0000-0000000000f1'
   or (account_no = '1403024652' and statement_name like 'BBL OD52 Statement%');
delete from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a1' or od_no = 'OD-OD52';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD52-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD52-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000c2','BBL','MA-OD52-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000c2','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000c1','d9d9e270-0000-0000-0000-0000000000c2',
   'CA-OD52-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD52-DEMO', 'MGC',
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
  ('d9d9e270-0000-0000-0000-0000000000a1','OD-OD52','OD-OD52',
   'd9d9e270-0000-0000-0000-0000000000c1','BBL', 2000000, 2000000, 1200000,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024652',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-52 · ยอดติดลบ (ยังไม่ลงบัญชี) ไว้ดู JE Preview แล้วลงจริงเทียบ', now(), now());

-- ④ Bank Statement (Active) — balance -1,200,000 (ใช้ OD → มีดอกเบี้ย) · ยังไม่ลงบัญชี
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f1','BBL','1403024652','BBL OD52 Statement','2026-08','Manual', false,
   'seed OD-52 · ยอดติดลบ ส.ค. (ยังไม่ลงบัญชี)', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e270-0000-0000-0000-0000000000e1','d9d9e270-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD', 1200000, 0, -1200000, 'Manual','aug', 0),
  ('d9d9e270-0000-0000-0000-0000000000e2','d9d9e270-0000-0000-0000-0000000000f1', date '2026-08-31','23:59','ENET','สิ้นเดือน', 0, 0, -1200000, 'Manual','aug eom', 1);

-- ⑤ ตรวจผล
select o.od_no, o.account_no,
       (select count(*) from journal_entries j where j.source_type='OD_ACCRUED' and j.source_id=o.id) as od_je_count,
       (select min(l.balance) from bank_statement_lines l
          join bank_statements s on s.id=l.statement_id
         where s.account_no=o.account_no and s.inactive=false) as min_balance
  from overdrafts o where o.id='d9d9e270-0000-0000-0000-0000000000a1';
-- คาดหวัง: od_je_count = 0 (ยังไม่ลงบัญชี) · min_balance = -1,200,000
--   → JE Preview โชว์ตัวเลขเดือน ส.ค. · พอกดลงจริงที่ Summary Transaction ใบจริงต้องตรงกับ preview
