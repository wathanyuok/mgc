-- ============================================================
-- Seed: OD-33 — ใบแจ้งยอดที่ปิดใช้งานแล้ว ต้องไม่ถูกนำมาคิด (ทั้งแท็บ Bank Transaction และตารางดอกเบี้ย)
--
--   • MA-OD33 / CA-OD33 (วงเงิน OD 5,000,000)
--   • OD-OD33 (Active) · account_no = 1403024625 · วงเงิน 5,000,000 · อัตรา 7.25%
--   • Bank Statement 1 ใบ (account_no 1403024625) · inactive = true (ปิดใช้งาน) · 2 บรรทัด
--
-- วิธีทดสอบ OD-33:
--   1. เปิด OD-OD33 → แท็บ Bank Transaction → ไม่มีรายการ (ใบเดียวที่มีถูกปิดใช้งาน)
--   2. แท็บ Schedule Calculate → Daily Transaction → ตารางดอกเบี้ยว่าง (ไม่คิดจากใบที่ปิดใช้งาน)
--   ผล: ทั้งสองแท็บอิง bankTxs ชุดเดียว (กรอง inactive=false) → ใบ Inactive ไม่ถูกนับทั้งคู่
--   (จะพิสูจน์กลับทาง: ไป master Bank Statement เปิดใช้งานใบนี้ (inactive=false) → รายการโผล่เข้าทั้ง 2 แท็บพร้อมกัน)
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ลบใบแจ้งยอดของ account นี้ที่ seed เคยสร้าง (ทั้ง f1 และ f2 จากเวอร์ชันก่อน) — กันเหลือใบซ้ำ
delete from bank_statement_lines where statement_id in ('d9d9e210-0000-0000-0000-0000000000f1','d9d9e210-0000-0000-0000-0000000000f2');
delete from bank_statements where id in ('d9d9e210-0000-0000-0000-0000000000f1','d9d9e210-0000-0000-0000-0000000000f2')
   or (account_no = '1403024625' and statement_name like 'BBL OD33 Statement%');
delete from overdrafts where id = 'd9d9e210-0000-0000-0000-0000000000a1' or od_no = 'OD-OD33';
delete from credit_agreements where id = 'd9d9e210-0000-0000-0000-0000000000c1' or contract_number = 'CA-OD33-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e210-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e210-0000-0000-0000-0000000000c2' or ma_name = 'MA-OD33-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e210-0000-0000-0000-0000000000c2','BBL','MA-OD33-DEMO','MGC','Approved',
   date '2026-06-01', date '2027-05-31', 5000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e210-0000-0000-0000-0000000000c2','MGC',5000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e210-0000-0000-0000-0000000000c1','d9d9e210-0000-0000-0000-0000000000c2',
   'CA-OD33-DEMO (วงเงิน OD 5 ล้าน)', 'CA-OD33-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   5000000, 'THB', 'Revolving', 'BBL',
   date '2026-06-01', date '2027-05-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":7.25,"condition":0,"overlimit":7.25,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ OD (Active) — FIELD ครบทุกช่อง
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('d9d9e210-0000-0000-0000-0000000000a1','OD-OD33','OD-OD33',
   'd9d9e210-0000-0000-0000-0000000000c1','BBL', 5000000, 5000000, 0,
   null, 7.25, date '2026-06-01', date '2026-06-01', date '2027-05-31', '1403024625',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":7.25,"condition":0,"overlimit":7.25,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-33 · OD ใช้ account_no 1403024625 ไว้ทดสอบใบแจ้งยอดปิดใช้งาน', now(), now());

-- ④ Bank Statement — ใบเดียว · INACTIVE (ปิดใช้งาน) → ต้องไม่ถูกนำมาคิดทั้งสองแท็บ
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e210-0000-0000-0000-0000000000f1','BBL','1403024625','BBL OD33 Statement (ปิดใช้งาน)','2026-08','Manual', true,
   'seed OD-33 · ใบที่ปิดใช้งาน ไม่ควรถูกนำมาคิด', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e210-0000-0000-0000-0000000000e1','d9d9e210-0000-0000-0000-0000000000f1', date '2026-08-01','10:00','TRANSFER','เบิกใช้ OD (ในใบที่ปิดใช้งาน)', 1000000, 0, -1000000, 'Manual','seed line 1', 0),
  ('d9d9e210-0000-0000-0000-0000000000e2','d9d9e210-0000-0000-0000-0000000000f1', date '2026-08-20','14:30','ENET','รับเงินเข้า (ในใบที่ปิดใช้งาน)', 0, 400000, -600000, 'Manual','seed line 2', 1);

-- ⑤ ตรวจผล — ใบนี้ inactive=true → bankTxs (กรอง inactive=false) จะไม่นับ → ทั้งสองแท็บว่าง
select bs.statement_name, bs.inactive,
       (select count(*) from bank_statement_lines l where l.statement_id = bs.id) as line_count
  from bank_statements bs
 where bs.account_no = '1403024625';
-- คาดหวัง: inactive=true · line_count=2 (มีข้อมูลอยู่แต่ถูกปิด) → แท็บ Bank Transaction + ตารางดอกเบี้ย ไม่แสดง/ไม่คิดใบนี้
