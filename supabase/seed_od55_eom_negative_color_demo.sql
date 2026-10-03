-- ============================================================
-- Seed: OD-55 — สีของยอดสิ้นเดือน (Utilization End of Month)
--   เคส: ยอดคงเหลือสิ้นเดือน "เป็นบวก" แต่พอหักดอกเบี้ยค้างแล้ว "ติดลบ"
--        → คอลัมน์ Utilization End of Month ต้องแสดงเป็นสีแดง + วงเล็บ (xxx)
--
--   • MA-OD55 / CA-OD55 (วงเงิน OD 2,000,000 · อัตรา 6%)
--   • OD-OD55 (Active) · account_no = 1403024655
--   • Bank Statement (Active) · ส.ค. 2026:
--       1 ส.ค.  ยอด -2,000,000 (เบิกเต็มวงเงิน → เกิดดอกเบี้ย 30 วัน)
--       31 ส.ค. ยอด +5,000     (ชำระคืนจนเหลือ "บวกเล็กน้อย")
--
--   ผลการคำนวณเดือน ส.ค. 2026:
--       Ending Balance (วันสุดท้าย) = +5,000            ← บวก
--       Interest (30 วัน)           = 9,863.01
--       Utilization End of Month    = 5,000 − 9,863.01 = (4,863.01)  ← ติดลบ → สีแดง
--
--   *** จุดที่เคยพลาด: โค้ดเดิมเช็คสีจาก endingBalance (ซึ่ง +5,000 = ไม่แดง)
--       ทั้งที่ตัวเลขที่โชว์คือ totalEndingBalance (−4,863.01) ตอนนี้แก้ให้เช็ค
--       จากตัวเลขที่โชว์จริงแล้ว — seed นี้ไว้กันการ regress ***
--
-- วิธีทดสอบ:
--   1. เปิด OD-OD55 → Schedule Calculate → Summary Transaction
--   2. ดูแถว Aug 2026 คอลัมน์ "Utilization End of Month"
--   ผล: แสดง (4,863.01) เป็นสีแดง (ตัวหนา) — ไม่ใช่สีดำ/ไม่ใช่ค่าบวก
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type='OD_ACCRUED' and source_id='d9d9e270-0000-0000-0000-0000000000a4';
delete from bank_statement_lines where statement_id = 'd9d9e270-0000-0000-0000-0000000000f4';
delete from bank_statements where id = 'd9d9e270-0000-0000-0000-0000000000f4'
   or (account_no = '1403024655' and statement_name like 'BBL OD55 Statement%');
delete from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a4' or od_no = 'OD-OD55';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c7' or contract_number = 'CA-OD55-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000c8';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c8' or ma_name = 'MA-OD55-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000c8','BBL','MA-OD55-DEMO','MGC','Approved',
   date '2026-01-01', date '2026-12-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000c8','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000c7','d9d9e270-0000-0000-0000-0000000000c8',
   'CA-OD55-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD55-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   2000000, 'THB', 'Revolving', 'BBL',
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
  ('d9d9e270-0000-0000-0000-0000000000a4','OD-OD55','OD-OD55',
   'd9d9e270-0000-0000-0000-0000000000c7','BBL', 2000000, 2000000, 2000000,
   null, 6, date '2026-01-01', date '2026-01-01', date '2026-12-31', '1403024655',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-55 · สิ้นเดือนบวกเล็กน้อยแต่หักดอกเบี้ยแล้วติดลบ → ทดสอบสีแดง', now(), now());

-- ④ Bank Statement (Active) — ส.ค.: 1 ส.ค. -2,000,000 · 31 ส.ค. +5,000
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f4','BBL','1403024655','BBL OD55 Statement','2026-08','Manual', false,
   'seed OD-55 · เบิกเต็ม 1 ส.ค. คืนจนเหลือบวกเล็กน้อย 31 ส.ค.', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e270-0000-0000-0000-00000000e401','d9d9e270-0000-0000-0000-0000000000f4', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD เต็มวงเงิน', 2000000, 0, -2000000, 'Manual','draw full', 0),
  ('d9d9e270-0000-0000-0000-00000000e402','d9d9e270-0000-0000-0000-0000000000f4', date '2026-08-31','15:00','DEPOSIT','ชำระคืน เหลือบวกเล็กน้อย', 0, 2005000, 5000, 'Manual','repay +5000', 1);

-- ⑤ ตรวจผล (คำนวณ totalEndingBalance ของเดือน ส.ค. เพื่อเทียบสีที่ควรเห็น)
--    endingBalance(วันสุดท้าย)=+5,000 · interest(30วัน)=2,000,000*6%/365*30
with calc as (
  select 5000::numeric as ending_bal,
         round(2000000 * 6.0/100/365 * 30, 2) as interest
)
select ending_bal, interest,
       (ending_bal - interest) as total_ending_balance,
       case when (ending_bal - interest) < 0 then 'RED (xxx)' else 'ปกติ' end as expected_color
  from calc;
-- คาดหวัง: ending_bal=5000 (บวก) · interest=9863.01 · total_ending_balance=-4863.01 · RED (xxx)
