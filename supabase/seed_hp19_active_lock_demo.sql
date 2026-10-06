-- ============================================================
-- Seed: HP-19 — สัญญาเช่าซื้อ (Hire Purchase) สถานะ Active → ฟิลด์ถูกล็อก แก้ไม่ได้
--
--   สร้าง HP-DEMO-019 (mode=hp · status=Active) ไว้ทดสอบว่า เปิดสัญญาที่มีผลแล้ว
--   ฟิลด์หลัก + ช่อง NOTE แก้ไม่ได้ (canEditFields = false) · ช่องสถานะยังแตะได้
--
-- วิธีทดสอบ HP-19 (อ้างอิง seed นี้):
--   1. เปิด HP-DEMO-019 (ไม่ใส่ ?view=1)
--   2. ลองแก้ฟิลด์หลัก (ยอด/อัตรา/วันที่) และช่อง NOTE
--   ผล: แก้ไม่ได้ (ล็อกเพราะ Active) · มีแถบสถานะบอกว่าสัญญาถูกล็อก · Status dropdown ยังแตะได้
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000001901' or lease_no = 'HP-DEMO-019';
delete from credit_agreements where id = 'd9d9ea50-0000-0000-0000-0000000019c1' or contract_number = 'CA-HP19-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9ea50-0000-0000-0000-0000000019a1';
delete from master_agreements where id = 'd9d9ea50-0000-0000-0000-0000000019a1' or ma_name = 'MA-HP19-DEMO';

-- ① MA
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9ea50-0000-0000-0000-0000000019a1','BBL','MA-HP19-DEMO','MGC','Approved',
   date '2026-01-01', date '2031-12-31', 30000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9ea50-0000-0000-0000-0000000019a1','MGC',30000000,0,0);

-- ② CA (HP)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9ea50-0000-0000-0000-0000000019c1','d9d9ea50-0000-0000-0000-0000000019a1',
   'CA-HP19-DEMO (วงเงินเช่าซื้อ HP)', 'CA-HP19-DEMO', 'MGC',
   (select id from facility_types where code='HP' limit 1),
   30000000, 'THB', 'Term', 'BBL',
   date '2026-01-01', date '2031-12-31', 'Approved', '[]'::jsonb, '[]'::jsonb);

-- ③ Lease HP (Active)
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000001901','HP-DEMO-019','d9d9ea50-0000-0000-0000-0000000019c1','MGC','hp',
   false,'HP19-CONTRACT-001', date '2026-09-01','Finance',
   'Monthly', date '2026-09-30', date '2030-09-29','Fix Installment / Fix Installment & Step payment','รถยนต์','รถกระบะ Toyota Hilux Revo',
   'MR0FR22G190000019','BBL',1200000,200000,1000000,1000000,
   5,48, date '2026-09-01',0,'with-last',0,
   0,0,0,5,48,7,
   true,false,true,true, null,
   '[
     {"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431106 ทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322106 หนี้สินตามสัญญาเช่าซื้อ Hire purchase"},
     {"id":"ac-3","type":"DEFERRED INTEREST","gl":"1501106 ดอกเบี้ยรอตัดบัญชี Hire purchase-สัญญาเช่าซื้อ"},
     {"id":"ac-4","type":"UNDUE INPUT VAT","gl":"1191204 ภาษีซื้อยังไม่ครบกำหนดขอคืน(เช่าซื้อ)"},
     {"id":"ac-5","type":"INTEREST EXPENSE ACCOUNT","gl":"5512113 ดอกเบี้ยจ่าย-Hire purchase"},
     {"id":"ac-6","type":"AP LEASE ACCOUNT","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"},
     {"id":"ac-7","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-8","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-9","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมทรัพย์สินตามสัญญาเช่าทางการเงิน-ยานพาหนะ(HP)"}
   ]'::jsonb,
   null,'Active','seed HP-19 · เช่าซื้อรถ 1,000,000 · 5% · 48 งวด · Active → ฟิลด์ถูกล็อก','BANKREF-HP19-001', now(), now());

-- ④ ตรวจผล
select lease_no, mode, status, principal, annual_rate, term_months
  from leases where id = 'd9d9ea50-0000-0000-0000-000000001901';
-- คาดหวัง: HP-DEMO-019 · hp · Active → เปิดแล้วฟิลด์หลัก + NOTE แก้ไม่ได้
