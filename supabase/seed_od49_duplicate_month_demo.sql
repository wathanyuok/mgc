-- ============================================================
-- Seed: OD-49 — ลงบัญชีเดือนเดิมซ้ำไม่ได้ (แสดงป้าย "ลงบัญชีแล้ว" + กันลงซ้ำ)
--
--   • MA-OD49 / CA-OD49 (วงเงิน OD 2,000,000)
--   • OD-OD49 (Active) · account_no = 1403024649 · วงเงิน 2,000,000 · อัตรา 6%
--   • Bank Statement (Active) · ส.ค. 2026 · balance -1,000,000 (ใช้ OD → มีดอกเบี้ย)
--   • JE OD_ACCRUED ของเดือน ส.ค. 2026 (source_period = 202608) · Posted  ← ลงบัญชีไว้แล้ว
--       JV-Interest:  Dr 5512108 ดอกเบี้ยจ่าย 5,000 / Cr 1001201 เงินฝาก 5,000
--       JV-Overdraft: Dr 1001201 เงินฝาก 1,000,000 / Cr 2142101 เงินเบิกเกินบัญชี 1,000,000
--
-- วิธีทดสอบ OD-49:
--   1. เปิด OD-OD49 → แท็บ Schedule Calculate → Summary Transaction → แถวเดือน ส.ค. 2026
--   ผล ①: แถวนั้นแสดงป้าย "✓ ลงบัญชีแล้ว" (คลิกเปิดใบ JE-OD49-AUG) + ปุ่ม "↩ Reverse" · ไม่มีปุ่มลงบัญชี
--   2. (ทดสอบลงซ้ำ) เปิด OD-OD49 อีกหน้าต่าง → กดลงเดือน ส.ค. เดิม
--   ผล ②: error "เดือน ส.ค. 2026 มีใบสำคัญอยู่แล้ว: JE-OD49-AUG"
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from je_lines where je_id = 'd9d9e260-0000-0000-0000-0000000000d1';
delete from journal_entries where id = 'd9d9e260-0000-0000-0000-0000000000d1';
delete from bank_statement_lines where statement_id = 'd9d9e260-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'd9d9e260-0000-0000-0000-0000000000f1'
   or (account_no = '1403024649' and statement_name like 'BBL OD49 Statement%');
delete from overdrafts where id = 'd9d9e260-0000-0000-0000-0000000000a1' or od_no = 'OD-OD49';
delete from credit_agreements where id = 'd9d9e260-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD49-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e260-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e260-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD49-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e260-0000-0000-0000-0000000000c2','BBL','MA-OD49-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e260-0000-0000-0000-0000000000c2','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e260-0000-0000-0000-0000000000c1','d9d9e260-0000-0000-0000-0000000000c2',
   'CA-OD49-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD49-DEMO', 'MGC',
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
  ('d9d9e260-0000-0000-0000-0000000000a1','OD-OD49','OD-OD49',
   'd9d9e260-0000-0000-0000-0000000000c1','BBL', 2000000, 2000000, 1000000,
   null, 6, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024649',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-49 · ลงบัญชีเดือน ส.ค. ไว้แล้ว ไว้ทดสอบกันลงซ้ำ', now(), now());

-- ④ Bank Statement (Active) — balance -1,000,000 (ใช้ OD → มีดอกเบี้ย)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e260-0000-0000-0000-0000000000f1','BBL','1403024649','BBL OD49 Statement','2026-08','Manual', false,
   'seed OD-49 · ยอดติดลบ ส.ค.', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e260-0000-0000-0000-0000000000e1','d9d9e260-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD', 1000000, 0, -1000000, 'Manual','aug', 0),
  ('d9d9e260-0000-0000-0000-0000000000e2','d9d9e260-0000-0000-0000-0000000000f1', date '2026-08-31','23:59','ENET','สิ้นเดือน', 0, 0, -1000000, 'Manual','aug eom', 1);

-- ⑤ JE OD_ACCRUED เดือน ส.ค. 2026 (source_period=202608 · Posted) — ลงบัญชีไว้แล้ว
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e260-0000-0000-0000-0000000000d1','JE-OD49-AUG','OD_ACCRUED',
   'd9d9e260-0000-0000-0000-0000000000a1', 202608, date '2026-08-31','Aug 2026',
   'OD-OD49 — Aug 2026 Accrued Interest', 1005000, 1005000, 'Posted',
   'seed', now(), false, 'seed OD-49 · ลงบัญชีเดือน ส.ค. แล้ว', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e260-0000-0000-0000-0000000000b1','d9d9e260-0000-0000-0000-0000000000d1',1,
   '5512108','ดอกเบี้ยจ่าย-Bank Overdraft',5000,0,'Interest expense — O/D'),
  ('d9d9e260-0000-0000-0000-0000000000b2','d9d9e260-0000-0000-0000-0000000000d1',2,
   '1001201','C/A - BBL#181-3-11063-0',0,5000,'Cash leg (offset)'),
  ('d9d9e260-0000-0000-0000-0000000000b3','d9d9e260-0000-0000-0000-0000000000d1',3,
   '1001201','C/A - BBL#181-3-11063-0',1000000,0,'Reclass utilized OD to Bank Overdraft liability'),
  ('d9d9e260-0000-0000-0000-0000000000b4','d9d9e260-0000-0000-0000-0000000000d1',4,
   '2142101','เงินกู้ยืมระยะสั้น-สถาบันการเงิน',0,1000000,'Bank Overdraft (Outstanding)');

-- ⑥ ตรวจผล
select o.od_no, o.account_no,
       (select je_number from journal_entries j
         where j.source_type='OD_ACCRUED' and j.source_id=o.id and j.source_period=202608
           and j.status='Posted' and j.is_reversal=false limit 1) as aug_je
  from overdrafts o where o.id='d9d9e260-0000-0000-0000-0000000000a1';
-- คาดหวัง: aug_je = JE-OD49-AUG → แถวเดือน ส.ค. แสดงป้าย "ลงบัญชีแล้ว" · กดลงซ้ำ → error มีใบสำคัญอยู่แล้ว: JE-OD49-AUG
