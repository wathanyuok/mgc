-- ============================================================
-- Seed: OD-54 / UC-OD-003 — หัวข้อเหนือตารางต้องตรงกับช่วงข้อมูลในตาราง
--
--   • MA-OD54 / CA-OD54 (วงเงิน OD 2,000,000 · อัตรา 6%)
--   • OD-OD54 (Active) · account_no = 1403024654
--   • Bank Statement (Active) · ยอดค้าง -500,000 ตั้งแต่ 15 พ.ย. 2026
--     ต่อเนื่องทุกต้นเดือนถึง ก.พ. 2027 แล้วปิดยอด 28 ก.พ. 2027
--     → ข้อมูลคร่อมปลายปี (2026 → 2027) เพื่อทดสอบหัวตารางช่วงปีด้วย
--
-- จุดที่ทดสอบ (หัวตารางต้องสะท้อนช่วงข้อมูลจริง):
--   • แท็บ Daily Transaction : หัวข้อ "ดอกเบี้ยรายวัน — {วันแรก} – {วันสุดท้าย}"
--       ต้องตรงกับวันแรก/วันสุดท้ายของแถวในตาราง
--   • แท็บ Summary Transaction: หัวข้อ "สรุปรายเดือน — ปี {ปีต่ำสุด – ปีสูงสุด}"
--       ต้องครอบคลุมทุกปีที่มีแถวในตาราง (ที่นี่ข้ามปี → 2026 – 2027)
--
-- วิธีทดสอบ UC-OD-003:
--   1. เปิด OD-OD54 → แท็บ Schedule Calculate
--   2. แท็บย่อย Daily Transaction → อ่านหัวข้อเหนือตาราง เทียบกับแถวแรก/แถวสุดท้าย
--   3. แท็บย่อย Summary Transaction → อ่านหัวข้อ "ปี ..." เทียบกับคอลัมน์ Month
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from journal_entries where source_type='OD_ACCRUED' and source_id='d9d9e270-0000-0000-0000-0000000000a3';
delete from bank_statement_lines where statement_id = 'd9d9e270-0000-0000-0000-0000000000f3';
delete from bank_statements where id = 'd9d9e270-0000-0000-0000-0000000000f3'
   or (account_no = '1403024654' and statement_name like 'BBL OD54 Statement%');
delete from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a3' or od_no = 'OD-OD54';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c5' or contract_number = 'CA-OD54-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000c6';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c6' or ma_name = 'MA-OD54-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000c6','BBL','MA-OD54-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000c6','MGC',2000000,0,0);

-- ② CA (facility OD · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000c5','d9d9e270-0000-0000-0000-0000000000c6',
   'CA-OD54-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD54-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   2000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
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
  ('d9d9e270-0000-0000-0000-0000000000a3','OD-OD54','OD-OD54',
   'd9d9e270-0000-0000-0000-0000000000c5','BBL', 2000000, 2000000, 500000,
   null, 6, date '2026-01-01', date '2026-01-01', date '2027-12-31', '1403024654',
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-54 / UC-OD-003 · ข้อมูลคร่อมปลายปี 2026→2027 ไว้ทดสอบหัวตาราง', now(), now());

-- ④ Bank Statement (Active) — ยอดค้างต้นเดือน พ.ย.2026–ก.พ.2027 · ปิด 28 ก.พ. 2027 = 0
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000f3','BBL','1403024654','BBL OD54 Statement','2026-2027','Manual', false,
   'seed OD-54 · ยอดค้าง 5 แสน คร่อมปลายปี', now(), now());
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance, source, remark, sort_order)
values
  ('d9d9e270-0000-0000-0000-00000000e301','d9d9e270-0000-0000-0000-0000000000f3', date '2026-11-15','10:00','TRANSFER','เบิกใช้ OD', 500000, 0, -500000, 'Manual','nov draw', 0),
  ('d9d9e270-0000-0000-0000-00000000e302','d9d9e270-0000-0000-0000-0000000000f3', date '2026-12-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -500000, 'Manual','dec', 1),
  ('d9d9e270-0000-0000-0000-00000000e303','d9d9e270-0000-0000-0000-0000000000f3', date '2027-01-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -500000, 'Manual','jan', 2),
  ('d9d9e270-0000-0000-0000-00000000e304','d9d9e270-0000-0000-0000-0000000000f3', date '2027-02-01','00:01','BALFWD','ยอดค้างต้นเดือน', 0, 0, -500000, 'Manual','feb', 3),
  ('d9d9e270-0000-0000-0000-00000000e305','d9d9e270-0000-0000-0000-0000000000f3', date '2027-02-28','09:00','ENET','ชำระคืนปิดยอด (จบช่วงทดสอบ)', 0, 500000, 0, 'Manual','repay', 4);

-- ⑤ ตรวจผล: ช่วงที่หัวตารางควรแสดง (เทียบด้วยตา)
select
  to_char(min(tx_date),'DD/MM/YYYY') as daily_header_from,  -- = วันแรกของหัวตารางรายวัน
  to_char(max(tx_date),'DD/MM/YYYY') as daily_header_to,    -- = วันสุดท้ายของหัวตารางรายวัน
  min(extract(year from tx_date))::int as summary_year_min, -- = ปีต่ำสุดของหัวตารางสรุป
  max(extract(year from tx_date))::int as summary_year_max  -- = ปีสูงสุดของหัวตารางสรุป
  from bank_statement_lines
 where statement_id = 'd9d9e270-0000-0000-0000-0000000000f3';
-- คาดหวัง: 15/11/2026 · 28/02/2027 · 2026 · 2027
--   → หัว Daily = "ดอกเบี้ยรายวัน — 15/11/2026 – 28/02/2027"
--   → หัว Summary = "สรุปรายเดือน — ปี 2026 – 2027"
