-- ============================================================
-- Seed: OD-64 — ห้ามข้ามขั้นอนุมัติ (Draft → ต้องอนุมัติก่อนจึงเปลี่ยนสถานะอื่นได้)
--
--   • MA-OD64 / CA-OD64 (Approved) เพื่อให้สร้าง OD ลูกได้
--   • OD-OD64 · status = 'Draft' · account_no = 1403024664
--
--   พฤติกรรมที่ถูกต้อง (filterStatusOptions เคส Draft):
--     ช่องสถานะของใบ Draft จะให้เลือกได้ "เฉพาะ Draft กับ Cancelled" เท่านั้น
--     → ไม่มี Active / Suspended / Closed ใน dropdown
--     → การทำให้ Active ต้องผ่าน "ปุ่มอนุมัติ" (Approval Panel) เท่านั้น ไม่ใช่เลือกเองในช่องสถานะ
--
-- วิธีทดสอบ UC (OD-64):
--   1. เปิด OD-OD64 (สถานะ Draft)
--   2. กดเปิด dropdown ช่อง "สถานะ"
--   ผล: เห็นแค่ 2 ตัวเลือก — Draft, Cancelled
--       *** ไม่มี Active/Suspended/Closed ให้เลือก = ข้ามขั้นอนุมัติไม่ได้ ***
--   3. (ทางเดินที่ถูก) ส่งอนุมัติด้วยปุ่มในกล่องอนุมัติ → ให้ผู้มีสิทธิ์อนุมัติ → สถานะจึงเป็น Active
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a5' or od_no = 'OD-OD64';
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000c9' or contract_number = 'CA-OD64-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000ca';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000ca' or ma_name = 'MA-OD64-DEMO';

-- ① MA + allocation (Approved)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000ca','BBL','MA-OD64-DEMO','MGC','Approved',
   date '2026-01-01', date '2026-12-31', 2000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000ca','MGC',2000000,0,0);

-- ② CA (Approved · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000c9','d9d9e270-0000-0000-0000-0000000000ca',
   'CA-OD64-DEMO (วงเงิน OD 2 ล้าน)', 'CA-OD64-DEMO', 'MGC',
   (select id from facility_types where code='OD' limit 1),
   2000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2026-12-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb);

-- ③ OD — status = Draft (ยังไม่อนุมัติ)
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, amount, used_amount,
   interest_rate_id, effective_rate, transaction_date, start_date, end_date, account_no,
   status, rate_cards, acct_cards, rollover_parent_id, remark, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000a5','OD-OD64','OD-OD64',
   'd9d9e270-0000-0000-0000-0000000000c9','BBL', 2000000, 2000000, 0,
   null, 6, date '2026-01-01', date '2026-01-01', date '2026-12-31', '1403024664',
   'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"}]'::jsonb,
   null, 'seed OD-64 · ใบ Draft ไว้ทดสอบว่าช่องสถานะข้ามไป Active ไม่ได้', now(), now());

-- ④ ตรวจผล
select od_no, status from overdrafts where id = 'd9d9e270-0000-0000-0000-0000000000a5';
-- คาดหวัง: OD-OD64 · Draft
--   เปิดในหน้าจอ → dropdown สถานะมีแค่ Draft, Cancelled (ไม่มี Active/Suspended/Closed)
