-- ============================================================
-- Seed: RP-46 — เงินต้นเช่าซื้อล้างบัญชีตัวเดียวกับ Day-1
-- สร้าง HP (Hire Purchase) ที่ลงบัญชีวันแรกแล้ว (Cr หนี้สินเช่าซื้อ 2322106)
-- ไว้ให้ไปสร้างใบตัดชำระ Principal แล้วเปิด JE ดูว่า Dr ที่ 2322106 (ตัวเดียวกับ Day-1)
--
--   • MA-RP46-DEMO / CA-RP46-DEMO  วงเงิน Lease 5,000,000
--   • HP-RP46   เช่าซื้อ (mode=hp · Active) ราคารถ 1,200,000 − ดาวน์ 200,000 = ยอดจัด 1,000,000
--   • JE Day-1 (LEASE_DAY1 · Posted · gross):
--       Dr ทรัพย์สิน HP 1431106      1,000,000
--       Dr ดอกเบี้ยรอตัด 1501106       100,000
--       Dr VAT ยังไม่ถึงกำหนด 1191204   77,000
--       Cr หนี้สินตามสัญญาเช่าซื้อ 2322106  1,177,000  (gross)
--
-- วิธีทดสอบ RP-46:
--   1. เมนู Repayment → New → FACILITY TYPE = HP → เลือก HP-RP46
--   2. Payment Category = Principal — เงินต้น → ใส่ยอด (เช่น 100,000) → Create Journal
--   3. เปิดใบ JE ที่เกิด → ดูคู่บัญชี
--   ผล: Dr = 2322106 หนี้สินตามสัญญาเช่าซื้อ (ตัวเดียวกับที่ Cr ไว้ตอน Day-1) ✅
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from je_lines where je_id = 'd9d9e190-0000-0000-0000-0000000000d1';
delete from journal_entries where id = 'd9d9e190-0000-0000-0000-0000000000d1';
delete from leases where id = 'd9d9e190-0000-0000-0000-0000000000a1' or lease_no = 'HP-RP46';
delete from credit_agreements where id = 'd9d9e190-0000-0000-0000-0000000000c1' or contract_number = 'CA-RP46-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e190-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e190-0000-0000-0000-0000000000c2' or ma_name = 'MA-RP46-DEMO';

-- ① MA + allocation
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e190-0000-0000-0000-0000000000c2','BBL','MA-RP46-DEMO','MGC','Approved',
   date '2026-09-01', date '2027-08-31', 5000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e190-0000-0000-0000-0000000000c2','MGC',5000000,0,0);

-- ② CA (facility LEASE · ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9e190-0000-0000-0000-0000000000c1','d9d9e190-0000-0000-0000-0000000000c2',
   'CA-RP46-DEMO (วงเงิน Lease 5 ล้าน)', 'CA-RP46-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   5000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ③ HP (เช่าซื้อ · Active · ลง Day-1 แล้ว) — FIELD ครบทุกช่อง
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9e190-0000-0000-0000-0000000000a1','HP-RP46',
   'd9d9e190-0000-0000-0000-0000000000c1','MGC','hp', true, 'HP-RP46-CONTRACT', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2030-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถกระบะ Toyota Hilux Revo',
   'MR0FR22G100000099','BBL',1200000,200000,1000000,1000000,
   5.0,48, date '2026-09-01',0,'with-last',0,
   0,0,0,5,48,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"DEFERRED INTEREST","gl":"1501106 ดอกเบี้ยรอตัดบัญชี Hire purchase"},
     {"id":"ac-4","type":"UNDUE INPUT VAT","gl":"1191204 ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)"},
     {"id":"ac-5","type":"INTEREST EXPENSE","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-6","type":"AP LEASING","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"},
     {"id":"ac-7","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   null, 'Active',
   'seed RP-46 · HP ลง Day-1 แล้ว ไว้ทดสอบจ่ายคืนต้น (ล้างที่ 2322106)', 'BBL-REF-RP46', now(), now());

-- ④ JE Day-1 (LEASE_DAY1 · Posted · gross)
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark, created_at, updated_at)
values
  ('d9d9e190-0000-0000-0000-0000000000d1','JE-RP46-DAY1','LEASE_DAY1',
   'd9d9e190-0000-0000-0000-0000000000a1', 0, date '2026-09-01','Sep 2026',
   'Day-1 HP-RP46 — ตั้งทรัพย์สิน+หนี้สินเช่าซื้อ (gross)', 1177000, 1177000, 'Posted',
   'seed', now(), false, 'seed RP-46 · Day-1 gross', now(), now());
insert into je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) values
  ('d9d9e190-0000-0000-0000-0000000000e1','d9d9e190-0000-0000-0000-0000000000d1',1,
   '1431106','ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)',1000000,0,'ยอดจัด (ราคารถ − ดาวน์)'),
  ('d9d9e190-0000-0000-0000-0000000000e2','d9d9e190-0000-0000-0000-0000000000d1',2,
   '1501106','ดอกเบี้ยรอตัดบัญชี Hire purchase',100000,0,'ดอกเบี้ยทั้งสัญญา (unearned)'),
  ('d9d9e190-0000-0000-0000-0000000000e3','d9d9e190-0000-0000-0000-0000000000d1',3,
   '1191204','ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)',77000,0,'VAT ยังไม่ถึงกำหนด'),
  ('d9d9e190-0000-0000-0000-0000000000e4','d9d9e190-0000-0000-0000-0000000000d1',4,
   '2322106','หนี้สินตามสัญญาเช่าซื้อ Hire purchase',0,1177000,'หนี้สินเช่าซื้อ (gross)');

-- ⑤ ตรวจผล
select l.lease_no, l.mode, l.status,
       (select account_code from je_lines jl join journal_entries j on j.id=jl.je_id
         where j.source_type='LEASE_DAY1' and j.source_id=l.id and jl.cr>0 limit 1) as day1_liability_acct
  from leases l where l.id='d9d9e190-0000-0000-0000-0000000000a1';
-- คาดหวัง: day1_liability_acct = 2322106 → จ่ายคืนต้นต้อง Dr 2322106 ตัวเดียวกัน
