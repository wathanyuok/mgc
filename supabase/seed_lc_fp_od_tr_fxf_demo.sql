-- ============================================================
-- Seed: 5 โมดูล — Floor Plan / Overdraft / L/C / Trust Receipt / FX Forward
-- FIELD ครบทุกช่อง · สาย MA → CA(รายโมดูล) → transaction · status Draft
-- facility code: FP / OD / LC / TR / FXF · acct_cards ตาม role ที่แต่ละโมดูลใช้จริง
-- รันซ้ำได้ (ลบ transaction ก่อน · MA/CA ใช้ upsert)
-- ============================================================

delete from floor_plans     where fp_no  = 'FP-DEMO-001'  or id='d9d9f000-0000-0000-0000-0000000000f1';
delete from overdrafts      where od_no  = 'OD-DEMO-001'  or id='d9d9f000-0000-0000-0000-0000000000f2';
delete from letters_of_credit where lc_no='LC-DEMO-001'  or id='d9d9f000-0000-0000-0000-0000000000f3';
delete from trust_receipts  where tr_no  = 'TR-DEMO-001'  or id='d9d9f000-0000-0000-0000-0000000000f4';
delete from fx_forwards     where fxf_no = 'FXF-DEMO-001' or id='d9d9f000-0000-0000-0000-0000000000f5';

-- ① MA (ใช้ร่วมทุกโมดูล)
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status, start_date, end_date,
   credit_line, utilization, guarantee_remark, inactive, remark, created_by, updated_by, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000a1','MA-DEMO-MULTI','BBL','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 100000000, 18050000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed 5 โมดูล · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set ma_name=excluded.ma_name, status=excluded.status,
   credit_line=excluded.credit_line, utilization=excluded.utilization, remark=excluded.remark, updated_at=now();
delete from ma_subsidiaries where ma_id='d9d9f000-0000-0000-0000-0000000000a1';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9f000-0000-0000-0000-0000000000a1','MGC',100000000,18050000,0);

-- ② CA รายโมดูล (5 ใบ)
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id, credit_line, utilization,
   currency, credit_type, finance_institution, curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark, rate_cards, acct_cards,
   start_date, end_date, status, created_by, updated_by, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000c1','CA เดโม — Floor Plan','CA-DEMO-FP',
   'd9d9f000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='FP' limit 1),
   30000000,5000000,'THB','Revolving','BBL',false,4,120,'วงเงินสต๊อกรถ Floor Plan','REF-FP-2026','seed FP','ค้ำโดย MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},{"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now()),
  ('d9d9f000-0000-0000-0000-0000000000c2','CA เดโม — Overdraft','CA-DEMO-OD',
   'd9d9f000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='OD' limit 1),
   3000000,3000000,'THB','Revolving','BBL',false,0,0,'วงเงินเบิกเกินบัญชี O/D','REF-OD-2026','seed OD','ค้ำโดย MGC',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-2","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"},{"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now()),
  ('d9d9f000-0000-0000-0000-0000000000c3','CA เดโม — Letter of Credit','CA-DEMO-LC',
   'd9d9f000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='LC' limit 1),
   20000000,3500000,'THB','Revolving','BBL',false,0,0,'วงเงิน L/C นำเข้า','REF-LC-2026','seed LC','ค้ำโดย MGC',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้ L/C"},{"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now()),
  ('d9d9f000-0000-0000-0000-0000000000c4','CA เดโม — Trust Receipt','CA-DEMO-TR',
   'd9d9f000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='TR' limit 1),
   20000000,3500000,'THB','Revolving','BBL',false,4,90,'วงเงินทรัสต์รีซีท T/R','REF-TR-2026','seed TR','ค้ำโดย MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},{"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now()),
  ('d9d9f000-0000-0000-0000-0000000000c5','CA เดโม — FX Forward','CA-DEMO-FXF',
   'd9d9f000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='FXF' limit 1),
   20000000,3550000,'THB','Revolving','BBL',false,0,0,'วงเงินซื้อขายเงินตราล่วงหน้า','REF-FXF-2026','seed FXF','ค้ำโดย MGC',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-4","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now())
on conflict (id) do update set ca_name=excluded.ca_name, facility_type_id=excluded.facility_type_id,
   rate_cards=excluded.rate_cards, acct_cards=excluded.acct_cards, status=excluded.status, updated_at=now();

-- ③ Floor Plan · field ครบ
insert into floor_plans
  (id, fp_no, name, ca_id, finance_institution, vendor, schedule_mode, start_date, end_date, transaction_date,
   maturity_date, term_days, amount, total_amount, used_amount, status, netting_ap, netting_ar, reference_contract,
   rollover_parent_id, currency, remark, rate_cards, acct_cards, cap_pct, bank_ref, po_ref, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000f1','FP-DEMO-001','Floor Plan เดโม','d9d9f000-0000-0000-0000-0000000000c1','BBL',
   'BMW (Thailand) Co., Ltd.','bmw', date '2026-09-01', date '2026-12-30', date '2026-09-01',
   date '2026-12-30',120,5000000,5000000,0,'Draft',false,false,'REF-FP-CONTRACT-001',
   null,'THB','seed FP · สต๊อกรถ 5,000,000 · 120 วัน',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY FLOOR PLAN ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"AP CAR ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},{"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   80,'BANKREF-FP-001','PO-FP-001', now(), now());

-- ③.1 FP Chassis (รถในสต๊อก) — จำเป็นสำหรับ Schedule Calculate (ตารางสร้างจากผลรวมรถ ไม่ใช่ช่อง amount)
delete from fp_chassis where fp_id='d9d9f000-0000-0000-0000-0000000000f1';
insert into fp_chassis
  (id, fp_id, chassis_no, engine_no, model, receive_date, amount, chassis_price, curtail_id,
   status, sort_order, original_location, current_location, location_modified_at)
values
  ('d9d9f000-0000-0000-0000-00000000ca01','d9d9f000-0000-0000-0000-0000000000f1','MR0FP-CHASSIS-001','ENG-FP-001','Toyota Hilux Revo', date '2026-09-01',2500000,3125000,null,'Active',0,'คลังสินค้า A','คลังสินค้า A', null),
  ('d9d9f000-0000-0000-0000-00000000ca02','d9d9f000-0000-0000-0000-0000000000f1','MR0FP-CHASSIS-002','ENG-FP-002','Toyota Fortuner', date '2026-09-01',2500000,3125000,null,'Active',1,'คลังสินค้า A','คลังสินค้า A', null);

-- ③ Overdraft · field ครบ
insert into overdrafts
  (id, od_no, name, ca_id, finance_institution, facility_limit, used_amount, amount, interest_rate_id, effective_rate,
   start_date, end_date, transaction_date, account_no, status, rollover_parent_id, currency, remark, rate_cards, acct_cards, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000f2','OD-DEMO-001','Overdraft เดโม','d9d9f000-0000-0000-0000-0000000000c2','BBL',
   3000000,0,3000000,null,6, date '2026-09-01', date '2027-08-31', date '2026-09-01','181-3-11063-0','Draft',null,'THB',
   'seed OD · วงเงิน O/D 3,000,000 · 6%',
   '[{"id":"rc-1","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-2","type":"INTEREST EXPENSE ACCOUNT","gl":"5512108 ดอกเบี้ยจ่าย-Bank Overdraft"},{"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   now(), now());

-- ③ Letter of Credit · field ครบ
insert into letters_of_credit
  (id, lc_no, name, ca_id, finance_institution, lc_type, beneficiary, applicant, currency, amount_foreign, conversion_rate, amount,
   issue_date, expiry_date, transaction_date, term_days, estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount, reference_fxf_id, parent_lc_id, reference_contract, shared_limit_with_tr,
   converted_tr_id, conversion_date, settlement_date, settlement_amount, settlement_fx_rate, closed_date, close_rate_type, close_rate,
   status, remark, rate_cards, acct_cards, created_by, updated_by, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000f3','LC-DEMO-001','L/C เดโม','d9d9f000-0000-0000-0000-0000000000c3','BBL','LC',
   'ABC Trading Co., Ltd.','MGC Asia','USD',100000,35,3500000,
   date '2026-09-01', date '2026-12-31', date '2026-09-01',90, date '2026-11-15', null,60,
   'full_term',1,0,35000,null,null,'REF-LC-CONTRACT-001',false,
   null,null,null,null,null,null,null,null,
   'Draft','seed LC · นำเข้า USD 100,000 @35 = 3,500,000 · fee 1%',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้ L/C"},{"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1), now(), now());

-- ③ Trust Receipt · field ครบ
insert into trust_receipts
  (id, tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date, due_date, transaction_date, maturity_date,
   term_days, amount, amount_foreign, conversion_date, conversion_rate, currency, reference_contract, rollover_parent_id,
   interest_rate_id, effective_rate, status, remark, rate_cards, acct_cards, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000f4','TR-DEMO-001','Trust Receipt เดโม','d9d9f000-0000-0000-0000-0000000000c4','BBL',
   'XYZ Import Co., Ltd.','INV-2026-001', date '2026-09-01', date '2026-12-01', date '2026-09-01', date '2026-12-01',
   90,3500000,100000, date '2026-09-01',35,'USD','REF-TR-CONTRACT-001',null,
   null,5,'Draft','seed TR · นำเข้า USD 100,000 @35 = 3,500,000 · 5% · 90 วัน',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"},{"id":"ac-5","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"}]'::jsonb,
   now(), now());

-- ③ FX Forward · field ครบ (ไม่มี rate_cards ในตารางนี้)
insert into fx_forwards
  (id, fxf_no, name, ca_id, finance_institution, deal_date, value_date, transaction_date, maturity_date, term_days,
   direction, ccy_buy, ccy_sell, currency, amount_buy, amount_sell, notional_amount_foreign, amount_thb, conversion_date,
   spot_rate, forward_rate, swap_points, swap_discount, discount_mode, reference_transaction, reference_tr_contract,
   status, remark, acct_cards, created_at, updated_at)
values
  ('d9d9f000-0000-0000-0000-0000000000f5','FXF-DEMO-001','FX Forward เดโม','d9d9f000-0000-0000-0000-0000000000c5','BBL',
   date '2026-09-01', date '2026-12-01', date '2026-09-01', date '2026-12-01',91,
   'Buy','USD','THB','USD',100000,3550000,100000,3550000, date '2026-09-01',
   35,35.5,0.5,0,'full_at_last_date','REF-FXF-TXN-001','REF-TR-CONTRACT-001',
   'Draft','seed FXF · ซื้อ USD 100,000 · spot 35 → forward 35.5 · ครบ 01/12/2026',
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-4","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   now(), now());

-- ตรวจผล
select 'FP' as m, fp_no as no, status::text from floor_plans where fp_no='FP-DEMO-001'
union all select 'OD', od_no, status::text from overdrafts where od_no='OD-DEMO-001'
union all select 'LC', lc_no, status::text from letters_of_credit where lc_no='LC-DEMO-001'
union all select 'TR', tr_no, status::text from trust_receipts where tr_no='TR-DEMO-001'
union all select 'FXF', fxf_no, status::text from fx_forwards where fxf_no='FXF-DEMO-001';
