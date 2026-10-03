-- ============================================================
-- Seed: OD-53 / UC-OD-004 — วันที่บนใบสำคัญต้องเป็น "วันสุดท้ายของเดือนนั้น"
--
--   • MA-OD53 / CA-OD53 (วงเงิน OD 3,000,000 · อัตรา 6%)
--   • OD-OD53 (Active) · account_no = 1403024653
--   • Bank Statement (Active) · มีบรรทัด "ยอดค้างต้นเดือน -1,000,000" ทุกวันที่ 1
--     ของเดือน ก.พ.–ส.ค. 2026 แล้วปิดด้วย 1 ก.ย. ชำระคืน (ยอด 0)
--     → มีดอกเบี้ย "เต็มเดือน" ทุกเดือน ก.พ.–ส.ค. (7 เดือน) จึงลงใบสำคัญได้ 7 ใบ
--
--   *** สำคัญ: ตัวคิดดอกเบี้ย (buildODDailyRows) คุมช่วงของแต่ละรายการไว้ไม่เกิน
--       "สิ้นเดือนของรายการนั้น" — ถ้าใส่รายการเดียวค้างข้ามหลายเดือน จะคิดดอกเบี้ย
--       แค่เดือนแรกเดือนเดียว ต้องมีรายการต้นเดือนของทุกเดือนที่ต้องการให้เกิดดอกเบี้ย ***
--
-- เหตุผลที่คุมช่วงนี้: ให้ SA เทียบวันที่ใบสำคัญครบทุกแบบในรอบเดียว
--     ก.พ. → 28 ก.พ. 2026  (เดือน 28 วัน — เคสสำคัญสุด)
--     เม.ย. → 30 เม.ย. 2026 (เดือน 30 วัน)
--     มิ.ย. → 30 มิ.ย. 2026 (เดือน 30 วัน)
--     มี.ค./พ.ค./ก.ค./ส.ค. → 31 ของเดือนนั้น (เดือน 31 วัน)
--
-- วิธีทดสอบ UC-OD-004 (เปิดใบที่ลงไปแล้ว → วันที่ = วันสุดท้ายของเดือน):
--   1. เปิด OD-OD53 → แท็บ Schedule Calculate → Summary Transaction
--   2. กด "ลงบัญชี" ทีละเดือน (หรือครบทุกเดือน ก.พ.–ส.ค.)
--   3. เปิดใบสำคัญที่ลงแล้วของแต่ละเดือน → ดูช่อง "วันที่ใบสำคัญ" (je_date)
--   ผลที่ต้องได้: je_date = วันสุดท้ายของเดือนนั้นเสมอ (ดูตารางด้านบน)
--      *** ไม่ใช่วันที่กดลงบัญชี และไม่ใช่วันที่ 1 ของเดือนถัดไป ***
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type='OD_ACCRUED' and source_id='d9d9e270-0000-0000-0000-0000000000a2';
delete from bank_statement_lines where statement_id = 'd9d9e270-0000-0000-0000-0000000000f2';
delete from bank_statements where id = 'd9d9e270-0000-0000-0000-0000000000f2'
   or (account_no = '1403024653' and statement_name like 'BBL OD53 Statement%');
delete from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a2' or od_no = 'OD-OD53';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c3' or contract_number = 'CA-OD53-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000c4';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c4' or ma_name = 'MA-OD53-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000c4','BBL','MA-OD53-DEMO','MGC','Approved',
   date '2026-01-01', date '2026-12-31', 3000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000c4','MGC',3000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000c3','d9d9e270-0000-0000-0000-0000000000c4',
   'CA-OD53-DEMO (วงเงิน OD 3 ล้าน)', 'CA-OD53-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   3000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2026-12-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ OD (Active) — FIELD ครบ
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000a2','OD-OD53','OD-OD53',
   'd9d9e270-0000-0000-0000-0000000000c3','BBL', 3000000, 3000000, 1000000,
   null, 6, date '2026-01-01', date '2026-01-01', date '2026-12-31', '1403024653',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-53 / UC-OD-004 · ยอดติดลบ ก.พ.–ส.ค. ไว้เทียบวันที่ใบสำคัญ = วันสุดท้ายของเดือน', now(), now());

-- ④ Bank Statement (Active) — ยอดค้างต้นเดือน -1,000,000 ทุกวันที่ 1 (ก.พ.–ส.ค.) · ปิด 1 ก.ย. = 0
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f2','BBL','1403024653','BBL OD53 Statement','2026-H1','Manual', false,
   'seed OD-53 · ยอดค้าง 1 ล้าน ต้นเดือนทุกเดือน ก.พ.–ส.ค.', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e270-0000-0000-0000-00000000e201','d9d9e270-0000-0000-0000-0000000000f2', date '2026-02-01','10:00','TRANSFER','เบิกใช้ OD', 1000000, 0, -1000000, 'Manual','feb', 0),
  ('d9d9e270-0000-0000-0000-00000000e202','d9d9e270-0000-0000-0000-0000000000f2', date '2026-03-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','mar', 1),
  ('d9d9e270-0000-0000-0000-00000000e203','d9d9e270-0000-0000-0000-0000000000f2', date '2026-04-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','apr', 2),
  ('d9d9e270-0000-0000-0000-00000000e204','d9d9e270-0000-0000-0000-0000000000f2', date '2026-05-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','may', 3),
  ('d9d9e270-0000-0000-0000-00000000e205','d9d9e270-0000-0000-0000-0000000000f2', date '2026-06-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','jun', 4),
  ('d9d9e270-0000-0000-0000-00000000e206','d9d9e270-0000-0000-0000-0000000000f2', date '2026-07-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','jul', 5),
  ('d9d9e270-0000-0000-0000-00000000e207','d9d9e270-0000-0000-0000-0000000000f2', date '2026-08-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -1000000, 'Manual','aug', 6),
  ('d9d9e270-0000-0000-0000-00000000e208','d9d9e270-0000-0000-0000-0000000000f2', date '2026-09-01','09:00','ENET','ชำระคืนปิดยอด (จบช่วงทดสอบ)', 0, 1000000, 0, 'Manual','sep repay', 7);

-- ⑤ ตรวจผล: หลังกด "ลงบัญชี" ครบทุกเดือนแล้ว รัน query นี้เทียบ je_date
--    je_date ของแต่ละเดือนต้องเป็นวันสุดท้ายของเดือนนั้น:
select je_number, source_period, je_date,
       (date_trunc('month', je_date) + interval '1 month - 1 day')::date as expected_eom,
       case when je_date = (date_trunc('month', je_date) + interval '1 month - 1 day')::date
            then 'OK' else 'FAIL' end as check_eom
  from journal_entries
 where source_type='OD_ACCRUED' and source_id='d9d9e270-0000-0000-0000-0000000000a2'
 order by je_date;
-- คาดหวัง: ทุกแถว check_eom = 'OK'
--   2026-02 → 2026-02-28 · 2026-03 → 2026-03-31 · 2026-04 → 2026-04-30
--   2026-05 → 2026-05-31 · 2026-06 → 2026-06-30 · 2026-07 → 2026-07-31 · 2026-08 → 2026-08-31
