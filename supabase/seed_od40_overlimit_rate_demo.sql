-- ============================================================
-- Seed: OD-40 — ความหมายของอัตราส่วนเกิน (overlimit rate)
-- ตั้งอัตราปกติ 6% + อัตราส่วนเกิน 2% · ทำยอดให้เกินวงเงิน · ดูดอกเบี้ยคิดแยก 2 ส่วน
--
--   • MA-OD40 / CA-OD40 (วงเงิน OD 1,000,000)
--   • OD-OD40 (Active) · account_no = 1403024640 · facility limit = 1,000,000
--       อัตราปกติ 6% · อัตราส่วนเกิน 2% (overlimit)
--   • Bank Statement (Active) account_no 1403024640 · 1 บรรทัด balance = -1,500,000 (เกินวงเงิน 500,000)
--
-- การคิดของระบบ (od-schedule.ts · blended) วันที่ยอด -1,500,000 · ลิมิต 1,000,000:
--   ในวงเงิน 1,000,000 × 6% / 365 × days  +  ส่วนเกิน 500,000 × 2% / 365 × days
--   เช่น 30 วัน = (1,000,000×6%/365×30) + (500,000×2%/365×30) = 4,931.51 + 821.92 = 5,753.43
--   (ตัวเลขจริงขึ้นกับจำนวนวันที่ระบบนับถึงสิ้นงวด — ดูบนจอ/tooltip)
--
-- วิธีทดสอบ OD-40:
--   1. เปิด OD-OD40 → แท็บ Schedule Calculate → Daily Transaction
--   2. แถววันที่ balance -1,500,000 → STATUS "⚠ Over Limit" · แสดง "ในวงเงิน 6.0000% / ส่วนเกิน 2.0000%"
--   3. hover tooltip → เทียบตัวเลขดอกเบี้ยกับที่คำนวณ
--   ผล: ดอกเบี้ย = ส่วนในวงเงิน(6%) + ส่วนเกิน(2%) ตรงกับข้อความบนจอ
--
-- หมายเหตุ: ระบบคิดส่วนเกินด้วยอัตรา 2% "ตรงๆ" (standalone) ไม่ใช่ 6%+2% — รอ confirm นิยามกับ SA
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from bank_statement_lines where statement_id = 'd9d9e220-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e220-0000-0000-0000-0000000000f1'
   or (account_no = '1403024640' and statement_name like 'BBL OD40 Statement%');
delete from overdrafts where id = 'd9d9e220-0000-0000-0000-0000000000a1' or od_no = 'OD-OD40';
delete from credit_agreements where id = 'd9d9e220-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD40-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e220-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e220-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD40-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e220-0000-0000-0000-0000000000c2','BBL','MA-OD40-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 1000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e220-0000-0000-0000-0000000000c2','MGC',1000000,0,0);

-- ② CA (facility OD · ผูก MA) — อัตราปกติ 6% · ส่วนเกิน 2%
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e220-0000-0000-0000-0000000000c1','d9d9e220-0000-0000-0000-0000000000c2',
   'CA-OD40-DEMO (วงเงิน OD 1 ล้าน · ส่วนเกิน 2%)', 'CA-OD40-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   1000000, 'THB', 'Revolving', 'BBL',
   date '2026-06-01', date '2027-05-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":2,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ OD (Active) — FIELD ครบ · วงเงิน 1,000,000 · อัตราปกติ 6% · ส่วนเกิน 2%
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('d9d9e220-0000-0000-0000-0000000000a1','OD-OD40','OD-OD40',
   'd9d9e220-0000-0000-0000-0000000000c1','BBL', 1000000, 1000000, 1500000,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024640',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":2,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-40 · วงเงิน 1 ล้าน · อัตรา 6% ส่วนเกิน 2% ไว้ทดสอบยอดเกินวงเงิน', now(), now());

-- ④ Bank Statement (Active) — balance -1,500,000 (เกินวงเงิน 500,000)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e220-0000-0000-0000-0000000000f1','BBL','1403024640','BBL OD40 Statement','2026-08','Manual', false,
   'seed OD-40 · ยอดเกินวงเงิน', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e220-0000-0000-0000-0000000000e1','d9d9e220-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกเกินวงเงิน (OD ใช้ 1.5 ล้าน · ลิมิต 1 ล้าน)', 1500000, 0, -1500000, 'Manual','seed over-limit', 0),
  ('d9d9e220-0000-0000-0000-0000000000e2','d9d9e220-0000-0000-0000-0000000000f1', date '2026-08-31','23:59','ENET','สิ้นเดือน', 0, 0, -1500000, 'Manual','seed month-end', 1);

-- ⑤ ตรวจผล
select o.od_no, o.facility_limit, o.account_no,
       (o.rate_cards->0->>'rate') as normal_rate,
       (o.rate_cards->0->>'overlimit') as overlimit_rate,
       (select l.balance from bank_statement_lines l
          join bank_statements s on s.id=l.statement_id
         where s.account_no=o.account_no and s.inactive=false
         order by l.tx_date limit 1) as first_balance
  from overdrafts o where o.id='d9d9e220-0000-0000-0000-0000000000a1';
-- คาดหวัง: facility_limit 1,000,000 · normal 6 · overlimit 2 · first_balance -1,500,000 (เกิน 500,000)
--   → Daily Transaction แถวนั้น Over Limit: ในวงเงิน 6% + ส่วนเกิน 2%
