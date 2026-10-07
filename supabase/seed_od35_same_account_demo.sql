-- ============================================================
-- Seed: OD-35 — 1 เลขบัญชี = 1 O/D ที่ยังมีผล (ระบบบล็อกเลขบัญชีซ้ำ)
--
--   • MA-OD35 / CA-OD35 (วงเงิน OD 10,000,000)
--   • OD-OD35-A (Active)  · account_no = 1403035555 · อัตรา 7.25%   ← ฉบับที่ "ยังมีผล"
--   • OD-OD35-OLD (Closed) · account_no = 1403035555 (เลขเดียวกัน)   ← ปิดแล้ว ไม่บล็อก (รองรับต่ออายุ)
--   • Bank Statement 1 ใบ (account_no 1403035555 · inactive=false) · 3 บรรทัด
--
-- พฤติกรรมระบบ (หลังแก้เป็น hard-block + unique index 0118):
--   - เลขบัญชี 1 เลข ให้มี O/D ที่ยังมีผล (ไม่ใช่ Closed/Cancelled) ได้แค่ 1 ฉบับ
--   - ฉบับที่ปิดแล้ว (OD-OD35-OLD = Closed) ไม่นับ → เปิดฉบับใหม่บนบัญชีเดิมได้ (Rollover)
--
-- วิธีทดสอบ:
--   1. เปิด OD-OD35-A → แท็บ Bank Transaction (3 รายการ) · Schedule Calculate (มีดอกเบี้ย) — ทำงานปกติ
--   2. สร้าง O/D ใหม่ → BANK REFERENCE (Account No) = 1403035555 (เลขเดียวกับ A ที่ยัง Active)
--      → กดบันทึก → ระบบ "บล็อก" ขึ้น error:
--        "เลขบัญชีนี้ถูกใช้กับวงเงินเบิกเกินบัญชีฉบับอื่นที่ยังมีผลอยู่แล้ว (OD-OD35-A) —
--         1 บัญชี = 1 O/D (ที่ยังไม่ปิด) · ปิดฉบับเดิมก่อน หรือใช้เลขบัญชีอื่น"
--   3. (พิสูจน์ Rollover) OD-OD35-OLD เป็น Closed อยู่บนบัญชีเดียวกัน แต่ไม่ได้บล็อก A → ปิดแล้วไม่นับ
--
-- FIELD ครบ · รันซ้ำได้
-- *** ต้องรัน migration 0118 ก่อน แล้วค่อยรัน seed นี้ (seed นี้ไม่สร้างข้อมูลที่ขัด unique index) ***
-- ============================================================

-- cleanup (idempotent)
delete from bank_statement_lines where statement_id = 'dddd3535-0000-0000-0000-0000000000f1';
delete from bank_statements where id = 'dddd3535-0000-0000-0000-0000000000f1'
   or (account_no = '1403035555' and statement_name like 'BBL OD35 Statement%');
delete from overdrafts where id in ('dddd3535-0000-0000-0000-0000000000a1','dddd3535-0000-0000-0000-0000000000a2')
   or od_no in ('OD-OD35-A','OD-OD35-OLD','OD-OD35-B');
delete from credit_agreements where id = 'dddd3535-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD35-DEMO';
delete from ma_subsidiaries where ma_id = 'dddd3535-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'dddd3535-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD35-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('dddd3535-0000-0000-0000-0000000000c2','BBL','MA-OD35-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 10000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('dddd3535-0000-0000-0000-0000000000c2','MGC',10000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('dddd3535-0000-0000-0000-0000000000c1','dddd3535-0000-0000-0000-0000000000c2',
   'CA-OD35-DEMO (วงเงิน OD 10 ล้าน)', 'CA-OD35-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   10000000, 'THB', 'Revolving', 'BBL',
   date '2026-06-01', date '2027-05-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":7.25,"condition":0,"overlimit":7.25,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ O/D ที่ยังมีผล (A · Active) — account_no 1403035555
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('dddd3535-0000-0000-0000-0000000000a1','OD-OD35-A','OD-OD35-A',
   'dddd3535-0000-0000-0000-0000000000c1','BBL', 10000000, 10000000, 0,
   null, 7.25, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403035555',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":7.25,"condition":0,"overlimit":7.25,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-35 (A · Active) · account_no 1403035555 — ฉบับที่ยังมีผล', now(), now());

-- ④ O/D เก่าที่ปิดแล้ว (OLD · Closed) — account_no เดียวกัน · ต้องไม่บล็อก A (รองรับ Rollover)
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('dddd3535-0000-0000-0000-0000000000a2','OD-OD35-OLD','OD-OD35-OLD',
   'dddd3535-0000-0000-0000-0000000000c1','BBL', 10000000, 0, 0,
   null, 7.25, date '2025-06-01', date '2025-06-01', date '2026-05-31', '1403035555',
   'Closed',
   '[{"id":"rc-1","type":"Fixed","rate":7.25,"condition":0,"overlimit":7.25,"start_date":"2025-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-35 (OLD · Closed) · บัญชีเดิม — ปิดแล้วไม่บล็อก', now(), now());

-- ⑤ Bank Statement (Active) — ใบเดียวสำหรับ account_no 1403035555 · 3 บรรทัด
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('dddd3535-0000-0000-0000-0000000000f1','BBL','1403035555','BBL OD35 Statement','2026-08','Manual', false,
   'seed OD-35 · บัญชีของ OD-OD35-A', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('dddd3535-0000-0000-0000-0000000000e1','dddd3535-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD', 2000000, 0, -2000000, 'Manual','seed line 1', 0),
  ('dddd3535-0000-0000-0000-0000000000e2','dddd3535-0000-0000-0000-0000000000f1', date '2026-08-12','11:15','TRANSFER','เบิกใช้ OD เพิ่ม', 1000000, 0, -3000000, 'Manual','seed line 2', 1),
  ('dddd3535-0000-0000-0000-0000000000e3','dddd3535-0000-0000-0000-0000000000f1', date '2026-08-25','14:30','ENET','รับเงินเข้า', 0, 1500000, -1500000, 'Manual','seed line 3', 2);

-- ⑥ ตรวจผล — ควรมี O/D ที่ "ยังมีผล" บน account นี้แค่ 1 ฉบับ (A) · OLD เป็น Closed
select o.od_no, o.account_no, o.status
from overdrafts o
where o.account_no = '1403035555'
order by o.status, o.od_no;
