-- ============================================================
-- Seed: FX-11 / UC-FXF-001 — เลือกวงเงิน (CREDIT AGREEMENT NAME) แล้วดึงผังบัญชีมาให้
--
--   • MA-FXF11 / CA-FXF11 (facility FXF · Approved) — มีผังบัญชี (acct_cards) ครบของ FXF
--     เพื่อให้ตอนเลือก CA ในหน้า FX Forward ระบบดึงผังบัญชีมาเติมอัตโนมัติ
--
--   acct types ที่ FXF ใช้ (ตรงกับ resolveFxfGL):
--     CASH / BANK ACCOUNT  1001201 C/A - BBL#181-3-11063-0
--     OTHER ACCOUNT        1001201 C/A - BBL#181-3-11063-0  (ขาเงินตราต่างประเทศ)
--     FEE EXPENSE ACCOUNT  5511101 ค่าธรรมเนียมธนาคาร
--     FX GAIN ACCOUNT      4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา
--     FX LOSS ACCOUNT      5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา
--
-- วิธีทดสอบ FX-11:
--   1. เปิดเมนู FX Forward → สร้างรายการใหม่
--   2. เปิดช่อง CREDIT AGREEMENT NAME → เห็น "CA-FXF11-DEMO" ในรายการ
--   3. เลือก CA-FXF11-DEMO
--   ผล: ช่องผังบัญชี (Accounting) ถูกเติมอัตโนมัติจากวงเงิน (5 บัญชีข้างบน)
--       + finance_institution เป็น BBL ตามวงเงิน
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e1' or contract_number = 'CA-FXF11-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000e2';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e2' or ma_name = 'MA-FXF11-DEMO';

-- ① MA + allocation (Approved)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000e2','BBL','MA-FXF11-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000e2','MGC',20000000,0,0);

-- ② CA (facility FXF · Approved · มี acct_cards ครบ)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000e1','d9d9e270-0000-0000-0000-0000000000e2',
   'CA-FXF11-DEMO (วงเงิน FX Forward 20 ล้าน)', 'CA-FXF11-DEMO', 'MGC',
   (select id from facility_types where code='FXF' limit 1),
   20000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-2","type":"OTHER ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-3","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb);

-- ③ ตรวจผล
select ca_name, contract_number, status,
       jsonb_array_length(acct_cards) as acct_card_count
  from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000e1';
-- คาดหวัง: CA-FXF11-DEMO · Approved · acct_card_count = 5
--   → เปิดหน้า FX Forward ใหม่ เลือก CA นี้ → ผังบัญชีถูกเติม 5 บัญชีอัตโนมัติ
