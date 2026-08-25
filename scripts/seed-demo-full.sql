-- =====================================================================
--  ข้อมูลตัวอย่างสำหรับเดโม / ทดสอบ — ครบทุกโมดูล ทุกสถานะ
--  -------------------------------------------------------------------
--  ทุกอย่างที่สคริปต์นี้สร้างขึ้นต้นด้วย "SEED-" เสมอ
--  จึงรันซ้ำได้ตลอด (ลบของเดิมที่ขึ้นต้นด้วย SEED- แล้วสร้างใหม่)
--  และไม่แตะข้อมูลจริงหรือชุดทดสอบอื่นที่ขึ้นต้นด้วย DEMO-
--
--  วันที่ทั้งหมดอิงจากวันนี้ ข้อมูลจึงดูสมจริงเสมอไม่ว่าจะรันเมื่อไร
--
--  วิธีใช้ — เปิด Supabase → SQL Editor → วางทั้งไฟล์ → Run
--  ใช้เวลาไม่กี่วินาที ตอนจบจะมีตารางสรุปว่าสร้างอะไรไปกี่รายการ
-- =====================================================================

-- ── ล้างชุดเดิมก่อน (ลูกๆ ถูกลบตามด้วย cascade) ──
delete from repayments        where repayment_no like 'SEED-%';
delete from leases            where lease_no     like 'SEED-%';
delete from loans             where loan_no      like 'SEED-%';
delete from fx_forwards       where fxf_no       like 'SEED-%';
delete from trust_receipts    where tr_no        like 'SEED-%';
delete from overdrafts        where od_no        like 'SEED-%';
delete from floor_plans       where fp_no        like 'SEED-%';
delete from letters_of_credit where lc_no        like 'SEED-%';
delete from letter_guarantees where lg_no        like 'SEED-%';
delete from promissory_notes  where name         like 'SEED-%';
delete from credit_agreements where ca_name      like 'SEED-%';
delete from master_agreements where ma_name      like 'SEED-%';
delete from bank_statements   where statement_name like 'SEED-%';
delete from vehicles          where chassis_no   like 'SEED%';
delete from journal_entries   where je_number    like 'SEED-%';
delete from interest_rates    where remark = 'SEED';
delete from curtailments      where remark = 'SEED';

-- =====================================================================
--  1. ข้อมูลหลัก — อัตราดอกเบี้ย · เงื่อนไขทยอยคืนเงินต้น
-- =====================================================================
insert into interest_rates (finance_institution, interest_type, base_rate, margin, date_effective, status, remark) values
  ('KBANK', 'MLR',   7.1000, 0.5000, current_date - 180, 'Active', 'SEED'),
  ('SCB',   'MOR',   7.3000, 0.2500, current_date - 180, 'Active', 'SEED'),
  ('BBL',   'MRR',   7.0500, 0.0000, current_date - 120, 'Active', 'SEED'),
  ('KTB',   'Fixed', 4.6500, 0.0000, current_date -  90, 'Active', 'SEED'),
  ('BAY',   'MLR',   6.9000, 0.7500, current_date -  60, 'Active', 'SEED');

insert into curtailments (vendor, vehicle_type, effective_start_date,
                          tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct,
                          status, remark) values
  ('BMW (Thailand) Co., Ltd.', 'New2026',  current_date - 200,  90, 10.00, 180, 20.00, 270, 30.00, 'Active', 'SEED'),
  ('BMW (Thailand) Co., Ltd.', 'Used2026', current_date - 200,  60, 15.00, 120, 30.00, 180, 50.00, 'Active', 'SEED');

-- =====================================================================
--  2. สัญญาหลัก (Master Agreement) + วงเงินย่อย · หลักประกัน · ผู้ค้ำ · เงื่อนไข
-- =====================================================================
do $$
declare
  v_ma1 uuid; v_ma2 uuid; v_ma3 uuid;
begin

  insert into master_agreements (finance_institution, ma_name, subsidiary, status, start_date, end_date,
                                 credit_line, utilization, guarantee_remark, remark)
  values ('KBANK', 'SEED-MA-001 กสิกรไทย วงเงินรวม', 'MCR', 'Approved',
          current_date - 365, current_date + 730, 500000000, 182000000,
          'ค้ำร่วมกันและแทนกัน (Joint & Several)', 'ชุดข้อมูลตัวอย่าง')
  returning id into v_ma1;

  insert into master_agreements (finance_institution, ma_name, subsidiary, status, start_date, end_date,
                                 credit_line, utilization, remark)
  values ('SCB', 'SEED-MA-002 ไทยพาณิชย์ วงเงินรวม', 'MAG', 'Pending Approval',
          current_date - 30, current_date + 1095, 300000000, 0, 'ชุดข้อมูลตัวอย่าง — รออนุมัติ')
  returning id into v_ma2;

  insert into master_agreements (finance_institution, ma_name, subsidiary, status, start_date, end_date,
                                 credit_line, utilization, remark)
  values ('BBL', 'SEED-MA-003 กรุงเทพ วงเงินรวม', 'MCR', 'Draft',
          current_date, current_date + 730, 150000000, 0, 'ชุดข้อมูลตัวอย่าง — ร่าง')
  returning id into v_ma3;

  -- วงเงินแบ่งตามบริษัทย่อย
  insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order) values
    (v_ma1, 'MCR', 300000000, 120000000, 1),
    (v_ma1, 'MAG', 150000000,  62000000, 2),
    (v_ma1, 'i24',  50000000,         0, 3),
    (v_ma2, 'MAG', 200000000,         0, 1),
    (v_ma2, 'MCR', 100000000,         0, 2);

  -- หลักประกัน
  insert into ma_collaterals (ma_id, type, description, amount, value, appraisal, appr_date,
                              location, doc_no, mortgage_limit, sort_order) values
    (v_ma1, 'realestate', 'ที่ดินพร้อมอาคารสำนักงาน ถ.พระราม 9', 250000000, 250000000, 268000000,
            current_date - 300, 'กรุงเทพมหานคร', 'นส.4จ. 12345', 250000000, 1);
  insert into ma_collaterals (ma_id, type, description, amount, chassis_no, vreg, vmodel, insurance_amount, sort_order) values
    (v_ma1, 'vehicle', 'รถยนต์นั่งส่วนบุคคล BMW 530e', 3200000, 'SEED-WBA5A1', '1กก-1234', 'BMW 530e M Sport', 3500000, 2);
  insert into ma_collaterals (ma_id, type, bank, acct_no, acct_name, deposit_amt, pledge_amt, sort_order) values
    (v_ma1, 'cash', 'KBANK', '140-3-02462-5', 'บริษัท มิลเลนเนียม กรุ๊ป จำกัด', 20000000, 20000000, 3);

  -- ผู้ค้ำประกัน
  insert into ma_guarantors (ma_id, type, name, id_card_or_tax_id, position, amount, expiry_date, phone, sort_order) values
    (v_ma1, 'บุคคลค้ำประกัน', 'นายสมชาย ใจดี', '1234567890123', 'กรรมการผู้จัดการ', 500000000,
            current_date + 730, '081-234-5678', 1);
  insert into ma_guarantors (ma_id, type, company_name, id_card_or_tax_id, amount, expiry_date, address, sort_order) values
    (v_ma1, 'นิติบุคคลค้ำประกัน', 'บริษัท มิลเลนเนียม โฮลดิ้ง จำกัด', '0105540001234', 500000000,
            current_date + 730, '999 ถ.พระราม 9 แขวงห้วยขวาง กรุงเทพฯ 10310', 2);

  -- เงื่อนไขทางการเงิน
  insert into ma_conditions (ma_id, de_op, de_value, dscr_op, dscr_value, other_requirement, consent_waiver) values
    (v_ma1, '<=', 2.50, '>=', 1.20,
     'ส่งงบการเงินที่ผู้สอบบัญชีรับรองภายใน 120 วันนับจากวันสิ้นรอบบัญชี',
     'ขอความยินยอมจากธนาคารก่อนจ่ายเงินปันผลเกิน 50% ของกำไรสุทธิ'),
    (v_ma2, '<=', 3.00, '>=', 1.10, 'ส่งงบการเงินภายในกำหนด', null);

end $$;

-- =====================================================================
--  3. วงเงินย่อย (Credit Agreement) + ผังดอกเบี้ย · ผังบัญชี · หลักประกัน
-- =====================================================================
do $$
declare
  v_ma1 uuid; v_ma2 uuid;
  v_ca uuid;
  v_rate jsonb;
  v_acct jsonb;
begin
  select id into v_ma1 from master_agreements where ma_name like 'SEED-MA-001%';
  select id into v_ma2 from master_agreements where ma_name like 'SEED-MA-002%';

  -- ผังดอกเบี้ยตัวอย่าง (ใช้ร่วมกันหลายวงเงิน)
  v_rate := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'type', 'MLR', 'rate', 7.10,
                       'condition', 0.50, 'overlimit', 2.00, 'start_date', to_char(current_date - 180, 'YYYY-MM-DD'))
  );
  -- ผังบัญชีตัวอย่าง — ธุรกรรมที่เปิดใต้วงเงินนี้จะรับไปเป็นค่าตั้งต้น
  v_acct := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'type', 'CASH / BANK ACCOUNT',      'gl', '100000 Cheque Account'),
    jsonb_build_object('id', gen_random_uuid(), 'type', 'INTEREST EXPENSE ACCOUNT', 'gl', '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น'),
    jsonb_build_object('id', gen_random_uuid(), 'type', 'FEE EXPENSE ACCOUNT',      'gl', '5511101 ค่าธรรมเนียมธนาคาร')
  );

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, utilization, start_date, end_date, status,
                                 currency, credit_type, curtailment_option, rate_cards, acct_cards, remark)
  values (v_ma1, 'SEED-CA-HP-001 วงเงินเช่าซื้อ', 'SEED-HP-2026-001', 'MCR', 'HP',
          (select id from facility_types where code = 'HP'),
          'KBANK', 200000000, 82000000, current_date - 300, current_date + 730, 'Approved',
          'THB', 'Revolving', true, v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง')
  returning id into v_ca;
  insert into ca_collaterals (ca_id, type, description, amount, value, sort_order)
    values (v_ca, 'vehicle', 'รถยนต์ที่เช่าซื้อภายใต้วงเงินนี้', 200000000, 200000000, 1);
  insert into ca_guarantors (ca_id, type, name, id_card_or_tax_id, amount, expiry_date, sort_order)
    values (v_ca, 'บุคคลค้ำประกัน', 'นายสมชาย ใจดี', '1234567890123', 200000000, current_date + 730, 1);
  insert into ca_conditions (ca_id, de_op, de_value, dscr_op, dscr_value, other_requirement)
    values (v_ca, '<=', 2.50, '>=', 1.20, 'รักษาอัตราส่วนหนี้สินต่อทุนตามที่ตกลง');

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, utilization, start_date, end_date, status,
                                 currency, credit_type, rate_cards, acct_cards, remark)
  values (v_ma1, 'SEED-CA-PN-001 วงเงินตั๋วสัญญาใช้เงิน', 'SEED-PN-2026-001', 'MCR', 'PN',
          (select id from facility_types where code = 'PN'),
          'KBANK', 100000000, 45000000, current_date - 300, current_date + 365, 'Approved',
          'THB', 'Revolving', v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง');

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, utilization, start_date, end_date, status,
                                 currency, credit_type, curtailment_option, rate_cards, acct_cards, remark)
  values (v_ma1, 'SEED-CA-FP-001 วงเงินสินเชื่อค้าดีลเลอร์', 'SEED-FP-2026-001', 'MAG', 'FP',
          (select id from facility_types where code = 'FP'),
          'KBANK', 150000000, 55000000, current_date - 300, current_date + 365, 'Approved',
          'THB', 'Revolving', true, v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง');

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, credit_line_foreign, fx_rate, fx_rate_date,
                                 utilization, start_date, end_date, status, currency, credit_type,
                                 rate_cards, acct_cards, remark)
  values (v_ma2, 'SEED-CA-LC-001 วงเงินเลตเตอร์ออฟเครดิต', 'SEED-LC-2026-001', 'MAG', 'LC',
          (select id from facility_types where code = 'LC'),
          'SCB', 105000000, 3000000, 35.000000, current_date - 30,
          0, current_date - 30, current_date + 365, 'Approved', 'USD', 'Revolving',
          v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง');

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, utilization, start_date, end_date, status,
                                 currency, credit_type, rate_cards, acct_cards, remark)
  values (v_ma1, 'SEED-CA-LOAN-001 วงเงินกู้ระยะยาว', 'SEED-LOAN-2026-001', 'MCR', 'LOAN',
          (select id from facility_types where code = 'LOAN'),
          'KTB', 80000000, 30000000, current_date - 200, current_date + 1460, 'Approved',
          'THB', 'Term Loan', v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง');

  insert into credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type, facility_type_id,
                                 finance_institution, credit_line, utilization, start_date, end_date, status,
                                 currency, credit_type, rate_cards, acct_cards, remark)
  values (v_ma2, 'SEED-CA-MIX-001 วงเงินรวม (รออนุมัติ)', 'SEED-MIX-2026-001', 'MAG', 'OD',
          (select id from facility_types where code = 'OD'),
          'SCB', 50000000, 0, current_date, current_date + 365, 'Pending Approval',
          'THB', 'Revolving', v_rate, v_acct, 'ชุดข้อมูลตัวอย่าง — รออนุมัติ');
end $$;

-- =====================================================================
--  4. ตั๋วสัญญาใช้เงิน (P/N) — ครบทุกสถานะ
-- =====================================================================
do $$
declare
  v_ca uuid; v_ft uuid; v_acct jsonb;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-PN-001%';
  select ft.id into v_ft from facility_types ft where ft.code = 'PN';
  select ca.acct_cards into v_acct from credit_agreements ca where ca.id = v_ca;

  insert into promissory_notes (name, pn_number, ca_id, finance_institution, facility_type, facility_type_id,
                                transaction_date, maturity_date, term_days, amount, currency,
                                effective_rate, status, acct_cards, remark) values
    ('SEED-PN-001', 'PN-2026-0001', v_ca, 'KBANK', 'PN', v_ft,
     current_date - 120, current_date + 60, 180, 20000000, 'THB', 7.6000, 'Active', v_acct, 'ตัวอย่าง — เบิกแล้ว กำลังเดินดอกเบี้ย'),
    ('SEED-PN-002', 'PN-2026-0002', v_ca, 'KBANK', 'PN', v_ft,
     current_date -  60, current_date + 120, 180, 15000000, 'THB', 7.6000, 'Active', v_acct, 'ตัวอย่าง'),
    ('SEED-PN-003', 'PN-2026-0003', v_ca, 'KBANK', 'PN', v_ft,
     current_date - 300, current_date - 120, 180, 10000000, 'THB', 7.3500, 'Repaid', v_acct, 'ตัวอย่าง — ชำระคืนครบแล้ว'),
    ('SEED-PN-004', 'PN-2026-0004', v_ca, 'KBANK', 'PN', v_ft,
     current_date -   5, current_date + 175, 180,  8000000, 'THB', 7.6000, 'Pending Approval', v_acct, 'ตัวอย่าง — รออนุมัติ'),
    ('SEED-PN-005', 'PN-2026-0005', v_ca, 'KBANK', 'PN', v_ft,
     current_date, current_date + 90, 90, 5000000, 'THB', 7.6000, 'Draft', v_acct, 'ตัวอย่าง — ร่าง'),
    ('SEED-PN-006', 'PN-2026-0006', v_ca, 'KBANK', 'PN', v_ft,
     current_date - 200, current_date - 20, 180, 12000000, 'THB', 7.3500, 'Cancelled', v_acct, 'ตัวอย่าง — ยกเลิก');
end $$;

-- =====================================================================
--  5. หนังสือค้ำประกัน (L/G) + ค่าธรรมเนียมรายงวด
-- =====================================================================
do $$
declare
  v_ca uuid; v_lg uuid; i int;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-HP-001%';

  insert into letter_guarantees (lg_no, name, lg_type, ca_id, finance_institution, beneficiary, subject,
                                 amount, currency, issue_date, expiry_date, status,
                                 payment_cycle, fee_amount, remark)
  values ('SEED-LG-001', 'SEED-LG-001 ค้ำประกันการไฟฟ้า', 'LG', v_ca, 'KBANK',
          'การไฟฟ้านครหลวง', 'ค้ำประกันการใช้ไฟฟ้าอาคารสำนักงาน',
          2000000, 'THB', current_date - 240, current_date + 120, 'Active',
          'รายไตรมาส', 15000, 'ตัวอย่าง — มีค่าธรรมเนียมรายงวด')
  returning id into v_lg;

  -- ค่าธรรมเนียมรายไตรมาส 4 งวด — 2 งวดแรกจ่ายแล้ว
  for i in 0..3 loop
    insert into lg_fees (lg_id, fee_date, description, rate_pct, amount, paid, paid_date, sort_order)
    values (v_lg, current_date - 240 + (i * 90), 'ค่าธรรมเนียมค้ำประกันไตรมาสที่ ' || (i + 1),
            0.7500, 3750, i < 2, case when i < 2 then current_date - 235 + (i * 90) else null end, i + 1);
  end loop;

  insert into letter_guarantees (lg_no, name, lg_type, ca_id, finance_institution, beneficiary, subject,
                                 amount, currency, issue_date, expiry_date, status, fee_amount, remark) values
    ('SEED-LG-002', 'SEED-LG-002 ค้ำประกันสัญญาซื้อขาย', 'BG', v_ca, 'KBANK',
     'บริษัท ผู้ซื้อ จำกัด', 'ค้ำประกันการปฏิบัติตามสัญญา', 5000000, 'THB',
     current_date - 30, current_date + 335, 'Pending Approval', 37500, 'ตัวอย่าง — รออนุมัติ'),
    ('SEED-LG-003', 'SEED-LG-003 ค้ำประกันภาษี', 'LG', v_ca, 'KBANK',
     'กรมสรรพากร', 'ค้ำประกันภาษีอากร', 1500000, 'THB',
     current_date, current_date + 365, 'Draft', 11250, 'ตัวอย่าง — ร่าง'),
    ('SEED-LG-004', 'SEED-LG-004 ค้ำประกันหมดอายุแล้ว', 'LG', v_ca, 'KBANK',
     'การประปานครหลวง', 'ค้ำประกันการใช้น้ำ', 800000, 'THB',
     current_date - 500, current_date - 135, 'Closed', 6000, 'ตัวอย่าง — ปิดแล้ว');
end $$;

-- =====================================================================
--  6. เลตเตอร์ออฟเครดิต (L/C)
-- =====================================================================
do $$
declare
  v_ca uuid;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-LC-001%';

  insert into letters_of_credit (lc_no, name, ca_id, finance_institution, lc_type, beneficiary, applicant,
                                 currency, amount_foreign, conversion_rate, amount,
                                 issue_date, expiry_date, transaction_date, term_days,
                                 fee_mode, fee_rate, fee_amount, status, shared_limit_with_tr, remark) values
    ('SEED-LC-001', 'SEED-LC-001 นำเข้ารถยนต์ล็อต 1', v_ca, 'SCB', 'LC',
     'BMW AG', 'บริษัท มิลเลนเนียม ออโต้ จำกัด', 'USD', 500000, 35.000000, 17500000,
     current_date - 90, current_date + 90, current_date - 90, 180,
     'full_term', 1.4800, 259000, 'Active', true, 'ตัวอย่าง — เปิดแล้ว รอรับมอบ'),
    ('SEED-LC-002', 'SEED-LC-002 นำเข้าอะไหล่', v_ca, 'SCB', 'LC',
     'BMW Parts GmbH', 'บริษัท มิลเลนเนียม ออโต้ จำกัด', 'USD', 120000, 34.800000, 4176000,
     current_date - 20, current_date + 160, current_date - 20, 180,
     'engagement_prorated', 1.2500, 52200, 'Approved', true, 'ตัวอย่าง — อนุมัติแล้ว'),
    ('SEED-LC-003', 'SEED-LC-003 นำเข้าเครื่องมือ', v_ca, 'SCB', 'LC',
     'Bosch Automotive', 'บริษัท มิลเลนเนียม ออโต้ จำกัด', 'USD', 80000, 35.200000, 2816000,
     current_date, current_date + 180, current_date, 180,
     'full_term', 1.4800, 41677, 'Draft', true, 'ตัวอย่าง — ร่าง'),
    ('SEED-LC-004', 'SEED-LC-004 ปิดแล้ว', v_ca, 'SCB', 'LC',
     'BMW AG', 'บริษัท มิลเลนเนียม ออโต้ จำกัด', 'USD', 300000, 34.500000, 10350000,
     current_date - 400, current_date - 220, current_date - 400, 180,
     'full_term', 1.4800, 153180, 'Closed', true, 'ตัวอย่าง — ปิดแล้ว');
end $$;

-- =====================================================================
--  7. สินเชื่อค้าดีลเลอร์ (Floor Plan) + รถในสต๊อก + ทะเบียนรถกลาง
-- =====================================================================
do $$
declare
  v_ca uuid; v_ft uuid; v_fp uuid; v_curt uuid; i int; v_ch text;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-FP-001%';
  select id into v_ft from facility_types where code = 'FP';
  select id into v_curt from curtailments where remark = 'SEED' and vehicle_type = 'New2026' limit 1;

  insert into floor_plans (fp_no, name, ca_id, finance_institution, vendor, schedule_mode,
                           start_date, end_date, transaction_date, maturity_date, term_days,
                           total_amount, used_amount, amount, cap_pct, currency, status,
                           netting_ap, netting_ar, remark)
  values ('SEED-FP-001', 'SEED-FP-001 รับรถล็อตเดือนนี้', v_ca, 'KBANK',
          'BMW (Thailand) Co., Ltd.', 'bmw',
          current_date - 90, current_date + 270, current_date - 90, current_date + 270, 360,
          40000000, 32000000, 40000000, 80.00, 'THB', 'Active', true, true,
          'ตัวอย่าง — มีรถในสต๊อก 5 คัน')
  returning id into v_fp;

  -- รถในสต๊อก 5 คัน — ขายไปแล้ว 2 คัน
  for i in 1..5 loop
    v_ch := 'SEEDWBA' || lpad(i::text, 6, '0');
    insert into fp_chassis (fp_id, chassis_no, engine_no, model, receive_date, amount, chassis_price,
                            curtail_id, status, original_location, current_location, sold_date, sort_order)
    values (v_fp, v_ch, 'SEEDENG' || lpad(i::text, 5, '0'),
            case when i <= 2 then 'BMW 320d M Sport' when i <= 4 then 'BMW X3 xDrive20d' else 'BMW 530e' end,
            current_date - 90 + (i * 3), 6400000, 8000000, v_curt,
            case when i <= 2 then 'Sold' else 'In Stock' end,
            'คลังบางนา', case when i <= 2 then 'ส่งมอบลูกค้า' else 'คลังบางนา' end,
            case when i <= 2 then current_date - 20 + i else null end, i);

    -- ทะเบียนรถกลาง — ใช้ทำรายงานรถซ้อนวงเงินและกระจายยอดทยอยคืนเงินต้นรายคัน
    insert into vehicles (chassis_no, engine_no, car_model, brand, color, model_year,
                          original_location, current_location, status, receive_date,
                          sold_date, sold_amount, cost, subsidiary, remark)
    values (v_ch, 'SEEDENG' || lpad(i::text, 5, '0'),
            case when i <= 2 then 'BMW 320d M Sport' when i <= 4 then 'BMW X3 xDrive20d' else 'BMW 530e' end,
            'BMW', case when i % 2 = 0 then 'ขาว' else 'ดำ' end, 2026,
            'คลังบางนา', case when i <= 2 then 'ส่งมอบลูกค้า' else 'คลังบางนา' end,
            case when i <= 2 then 'Sold' else 'Open' end,
            current_date - 90 + (i * 3),
            case when i <= 2 then current_date - 20 + i else null end,
            case when i <= 2 then 8500000 else null end,
            8000000, 'MAG', 'ชุดข้อมูลตัวอย่าง');
  end loop;

  insert into floor_plans (fp_no, name, ca_id, finance_institution, vendor, schedule_mode,
                           start_date, end_date, transaction_date, maturity_date, term_days,
                           total_amount, used_amount, amount, cap_pct, currency, status, remark) values
    ('SEED-FP-002', 'SEED-FP-002 ล็อตถัดไป', v_ca, 'KBANK', 'BMW (Thailand) Co., Ltd.', 'bmw',
     current_date, current_date + 360, current_date, current_date + 360, 360,
     25000000, 0, 25000000, 80.00, 'THB', 'Pending Approval', 'ตัวอย่าง — รออนุมัติ'),
    ('SEED-FP-003', 'SEED-FP-003 ร่าง', v_ca, 'KBANK', 'ผู้จำหน่ายอื่น', 'other',
     current_date, current_date + 180, current_date, current_date + 180, 180,
     10000000, 0, 10000000, 75.00, 'THB', 'Draft', 'ตัวอย่าง — ร่าง'),
    ('SEED-FP-004', 'SEED-FP-004 ปิดแล้ว', v_ca, 'KBANK', 'BMW (Thailand) Co., Ltd.', 'bmw',
     current_date - 500, current_date - 140, current_date - 500, current_date - 140, 360,
     30000000, 30000000, 30000000, 80.00, 'THB', 'Closed', 'ตัวอย่าง — ปิดแล้ว');
end $$;

-- =====================================================================
--  8. เบิกเกินบัญชี (O/D)
-- =====================================================================
do $$
declare
  v_ca uuid;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-MIX-001%';

  insert into overdrafts (od_no, name, ca_id, finance_institution, facility_limit, used_amount,
                          effective_rate, start_date, end_date, transaction_date, account_no,
                          amount, currency, status, remark) values
    ('SEED-OD-001', 'SEED-OD-001 บัญชีเดินสะพัดหลัก', v_ca, 'SCB', 20000000, 8500000,
     7.5500, current_date - 200, current_date + 165, current_date - 200, '140-3-02462-5',
     20000000, 'THB', 'Active', 'ตัวอย่าง — เบิกใช้อยู่ 8.5 ล้าน'),
    ('SEED-OD-002', 'SEED-OD-002 บัญชีสำรอง', v_ca, 'SCB', 10000000, 0,
     7.5500, current_date - 100, current_date + 265, current_date - 100, '140-3-09999-1',
     10000000, 'THB', 'Suspended', 'ตัวอย่าง — ระงับการใช้ชั่วคราว'),
    ('SEED-OD-003', 'SEED-OD-003 ร่าง', v_ca, 'SCB', 5000000, 0,
     7.5500, current_date, current_date + 365, current_date, '140-3-08888-2',
     5000000, 'THB', 'Draft', 'ตัวอย่าง — ร่าง'),
    ('SEED-OD-004', 'SEED-OD-004 ปิดแล้ว', v_ca, 'SCB', 15000000, 0,
     7.2500, current_date - 600, current_date - 235, current_date - 600, '140-3-07777-3',
     15000000, 'THB', 'Closed', 'ตัวอย่าง — ปิดแล้ว');
end $$;

-- =====================================================================
--  9. ทรัสต์รีซีท (T/R) + รายการสินค้านำเข้า
-- =====================================================================
do $$
declare
  v_ca uuid; v_tr uuid; v_lc uuid;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-LC-001%';
  select id into v_lc from letters_of_credit where lc_no = 'SEED-LC-004';

  insert into trust_receipts (tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date,
                              due_date, term_days, amount, amount_foreign, conversion_rate, conversion_date,
                              currency, effective_rate, transaction_date, maturity_date, status,
                              source_lc_id, remark)
  values ('SEED-TR-001', 'SEED-TR-001 รับมอบรถนำเข้า', v_ca, 'SCB', 'BMW AG',
          'INV-IMP-2026-0421', current_date - 60, current_date + 30, 90,
          10350000, 300000, 34.500000, current_date - 60, 'USD', 6.8500,
          current_date - 60, current_date + 30, 'Active', v_lc, 'ตัวอย่าง — แปลงมาจาก L/C')
  returning id into v_tr;

  insert into tr_imported_goods (tr_id, reference_no, description, vendor, amount_foreign, sort_order) values
    (v_tr, 'INV-IMP-2026-0421', 'BMW 320d M Sport จำนวน 10 คัน', 'BMW AG', 200000, 1),
    (v_tr, 'INV-IMP-2026-0422', 'BMW X3 xDrive20d จำนวน 4 คัน',  'BMW AG', 100000, 2);

  insert into trust_receipts (tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date,
                              due_date, term_days, amount, currency, effective_rate,
                              transaction_date, maturity_date, status, remark) values
    ('SEED-TR-002', 'SEED-TR-002 อะไหล่', v_ca, 'SCB', 'BMW Parts GmbH',
     'INV-IMP-2026-0500', current_date - 200, current_date - 110, 90,
     4176000, 'THB', 6.8500, current_date - 200, current_date - 110, 'Repaid', 'ตัวอย่าง — ชำระคืนแล้ว'),
    ('SEED-TR-003', 'SEED-TR-003 ร่าง', v_ca, 'SCB', 'Bosch Automotive',
     'INV-IMP-2026-0600', current_date, current_date + 90, 90,
     2816000, 'THB', 6.8500, current_date, current_date + 90, 'Draft', 'ตัวอย่าง — ร่าง'),
    ('SEED-TR-004', 'SEED-TR-004 ยกเลิก', v_ca, 'SCB', 'BMW AG',
     'INV-IMP-2026-0700', current_date - 150, current_date - 60, 90,
     3000000, 'THB', 6.8500, current_date - 150, current_date - 60, 'Cancelled', 'ตัวอย่าง — ยกเลิก');
end $$;

-- =====================================================================
--  10. สัญญาซื้อขายเงินตราต่างประเทศล่วงหน้า (FX Forward) + ค่าธรรมเนียม + มูลค่ายุติธรรม
-- =====================================================================
do $$
declare
  v_ca uuid; v_fxf uuid;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-LC-001%';

  insert into fx_forwards (fxf_no, name, ca_id, finance_institution, deal_date, value_date,
                           transaction_date, maturity_date, term_days, direction,
                           ccy_buy, ccy_sell, amount_buy, amount_sell,
                           spot_rate, forward_rate, swap_points, amount_thb, currency, status, remark)
  values ('SEED-FXF-001', 'SEED-FXF-001 ป้องกันความเสี่ยง L/C', v_ca, 'SCB',
          current_date - 45, current_date + 45, current_date - 45, current_date + 45, 90, 'Buy',
          'USD', 'THB', 500000.0000, 17600000.0000,
          35.000000, 35.200000, 0.200000, 17600000, 'USD', 'Active', 'ตัวอย่าง — ยังไม่ครบกำหนด')
  returning id into v_fxf;

  insert into fxf_fees (fxf_id, gl_date, spot_fee, cancellation_amendment_fee, remark)
    values (v_fxf, current_date - 45, 5000, 0, 'ค่าธรรมเนียมทำสัญญา');
  insert into fxf_fair_values (fxf_id, accounting_period, fair_value, unrealized_gain_loss, remark) values
    (v_fxf, date_trunc('month', current_date - 30)::date,  120000,  120000, 'ประเมินมูลค่าสิ้นเดือน'),
    (v_fxf, date_trunc('month', current_date)::date,       -45000,  -45000, 'ประเมินมูลค่าสิ้นเดือน');

  insert into fx_forwards (fxf_no, name, ca_id, finance_institution, deal_date, value_date,
                           transaction_date, maturity_date, term_days, direction,
                           ccy_buy, ccy_sell, amount_buy, amount_sell,
                           spot_rate, forward_rate, amount_thb, currency, status, remark) values
    ('SEED-FXF-002', 'SEED-FXF-002 ครบกำหนดแล้ว', v_ca, 'SCB',
     current_date - 200, current_date - 110, current_date - 200, current_date - 110, 90, 'Buy',
     'USD', 'THB', 300000.0000, 10380000.0000, 34.500000, 34.600000, 10380000, 'USD', 'Settled', 'ตัวอย่าง — ส่งมอบแล้ว'),
    ('SEED-FXF-003', 'SEED-FXF-003 ร่าง', v_ca, 'SCB',
     current_date, current_date + 90, current_date, current_date + 90, 90, 'Buy',
     'USD', 'THB', 120000.0000, 4224000.0000, 35.100000, 35.200000, 4224000, 'USD', 'Draft', 'ตัวอย่าง — ร่าง'),
    ('SEED-FXF-004', 'SEED-FXF-004 ยกเลิก', v_ca, 'SCB',
     current_date - 90, current_date, current_date - 90, current_date, 90, 'Sell',
     'THB', 'USD', 3500000.0000, 100000.0000, 35.000000, 35.000000, 3500000, 'USD', 'Cancelled', 'ตัวอย่าง — ยกเลิก');
end $$;

-- =====================================================================
--  11. เงินกู้ (Loan) + ตารางผ่อน + รถที่ผูกกับสัญญา
-- =====================================================================
do $$
declare
  v_ca uuid; v_loan uuid;
  v_principal numeric := 30000000;
  v_rate numeric := 4.6500;
  v_term int := 48;
  r numeric; v_pmt numeric; v_bal numeric; v_int numeric; v_prin numeric;
  i int; v_due date;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-LOAN-001%';

  insert into loans (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate,
                     effective_rate, term_months, start_date, installment_start_date, installment_end_date,
                     end_date, transaction_date, payment_freq, payment_type, pay_eom, currency,
                     grace_months, allow_prepayment, prepayment_fee_base, status, remark)
  values ('SEED-LOAN-001', 'SEED-LOAN-001 กู้ซื้อเครื่องมือโรงงาน', v_ca, 'KTB',
          v_principal, v_principal, v_rate, v_rate, v_term,
          current_date - 180, current_date - 150, current_date - 150 + (v_term * 30),
          current_date - 150 + (v_term * 30), current_date - 180,
          'monthly', 'Fix Installment', true, 'THB', 0, 'Yes', 'Outstanding Principal',
          'Active', 'ตัวอย่าง — ผ่อนมาแล้ว 5 งวด')
  returning id into v_loan;

  -- ตารางผ่อนแบบค่างวดเท่ากันทุกงวด
  r := v_rate / 100 / 12;
  v_pmt := round(v_principal * r * power(1 + r, v_term) / (power(1 + r, v_term) - 1), 2);
  v_bal := v_principal;
  for i in 1..v_term loop
    v_due  := (current_date - 150) + ((i - 1) * interval '1 month');
    v_int  := round(v_bal * r, 2);
    v_prin := round(v_pmt - v_int, 2);
    if i = v_term then v_prin := v_bal; v_pmt := round(v_prin + v_int, 2); end if;
    insert into loan_schedules (loan_id, period, due_date, begin_balance, payment, interest, principal,
                                end_balance, paid, paid_date)
    values (v_loan, i, v_due, v_bal, v_pmt, v_int, v_prin, v_bal - v_prin,
            v_due <= current_date, case when v_due <= current_date then v_due else null end);
    v_bal := v_bal - v_prin;
  end loop;

  insert into loan_chassis (loan_id, chassis_no, car_model, location, cost, status, sort_order) values
    (v_loan, 'SEEDLOAN000001', 'BMW X5 xDrive45e', 'สำนักงานใหญ่', 5500000, 'Active', 1),
    (v_loan, 'SEEDLOAN000002', 'BMW X5 xDrive45e', 'สำนักงานใหญ่', 5500000, 'Active', 2);

  insert into loans (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate,
                     term_months, start_date, end_date, transaction_date, payment_freq,
                     payment_type, currency, status, remark) values
    ('SEED-LOAN-002', 'SEED-LOAN-002 กู้ขยายสาขา', v_ca, 'KTB', 20000000, 20000000, 4.9000, 60,
     current_date - 10, current_date - 10 + (60 * 30), current_date - 10, 'monthly',
     'Fix Installment', 'THB', 'Pending Approval', 'ตัวอย่าง — รออนุมัติ'),
    ('SEED-LOAN-003', 'SEED-LOAN-003 ร่าง', v_ca, 'KTB', 10000000, 10000000, 5.2500, 36,
     current_date, current_date + (36 * 30), current_date, 'monthly',
     'Fix Principal', 'THB', 'Draft', 'ตัวอย่าง — ร่าง · เงินต้นเท่ากันทุกงวด'),
    ('SEED-LOAN-004', 'SEED-LOAN-004 ปิดแล้ว', v_ca, 'KTB', 8000000, 8000000, 5.0000, 24,
     current_date - 900, current_date - 180, current_date - 900, 'monthly',
     'Fix Installment', 'THB', 'Closed', 'ตัวอย่าง — ปิดแล้ว');
end $$;

-- =====================================================================
--  12. สัญญาเช่า 3 ชนิด — เช่าซื้อ · เช่า · เช่าอื่น (+ ตารางผ่อน)
-- =====================================================================
do $$
declare
  v_ca uuid; v_lease uuid;
  r numeric; v_pmt numeric; v_bal numeric; v_int numeric; v_prin numeric;
  i int; v_due date; v_term int; v_principal numeric; v_rate numeric;
begin
  select id into v_ca from credit_agreements where ca_name like 'SEED-CA-HP-001%';

  -- ── เช่าซื้อ (Hire Purchase) ──
  v_principal := 2400000; v_rate := 4.6500; v_term := 48;
  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, chassis_no, vendor, vehicle_price, down_payment,
                      net_vehicle_cost, principal, annual_rate, vat_rate, term_months,
                      start_date, payment_start_date, end_date, payment_frequency, payment_type,
                      payment_timing, pay_eom, classification, status, bank_ref, remark)
  values ('SEED-HP-001', 'SEED-HP-2026-0001', current_date - 150, v_ca, 'hp', true,
          'ยานพาหนะ', 'BMW 320d M Sport', 'SEEDHP00000001', 'BMW (Thailand) Co., Ltd.',
          3000000, 600000, 2400000, v_principal, v_rate, 7, v_term,
          current_date - 150, current_date - 120, current_date - 120 + (v_term * 30),
          'Monthly', 'Fix Installment', 'arrears', true, 'Finance', 'Active',
          'KBANK-HP-0001', 'ตัวอย่าง — เช่าซื้อรถ ผ่อนมาแล้ว 4 งวด')
  returning id into v_lease;

  r := v_rate / 100 / 12;
  v_pmt := round(v_principal * r * power(1 + r, v_term) / (power(1 + r, v_term) - 1), 2);
  v_bal := v_principal;
  for i in 1..v_term loop
    v_due  := (current_date - 120) + ((i - 1) * interval '1 month');
    v_int  := round(v_bal * r, 2);
    v_prin := round(v_pmt - v_int, 2);
    if i = v_term then v_prin := v_bal; end if;
    insert into lease_schedules (lease_id, period, due_date, begin_balance, payment, interest, principal,
                                 end_balance, vat, total_inc_vat, paid, paid_date)
    values (v_lease, i, v_due, v_bal, v_pmt, v_int, v_prin, v_bal - v_prin,
            round(v_pmt * 0.07, 2), round(v_pmt * 1.07, 2),
            v_due <= current_date, case when v_due <= current_date then v_due else null end);
    v_bal := v_bal - v_prin;
  end loop;

  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, chassis_no, vendor, vehicle_price, down_payment,
                      net_vehicle_cost, principal, annual_rate, vat_rate, term_months,
                      start_date, payment_start_date, end_date, payment_frequency, payment_type,
                      balloon_amount, classification, status, bank_ref, remark) values
    ('SEED-HP-002', 'SEED-HP-2026-0002', current_date - 20, v_ca, 'hp', true,
     'ยานพาหนะ', 'BMW X3 xDrive20d', 'SEEDHP00000002', 'BMW (Thailand) Co., Ltd.',
     3500000, 700000, 2800000, 2800000, 4.6500, 7, 36,
     current_date - 20, current_date + 10, current_date + 10 + (36 * 30),
     'Monthly', 'Balloon', 500000, 'Finance', 'Approved', 'KBANK-HP-0002',
     'ตัวอย่าง — อนุมัติแล้ว มีเงินก้อนท้ายสัญญา'),
    ('SEED-HP-003', 'SEED-HP-2026-0003', current_date, v_ca, 'hp', true,
     'อุปกรณ์', 'เครื่องมือซ่อมบำรุงศูนย์บริการ', '000', 'ผู้จำหน่ายอุปกรณ์',
     1200000, 200000, 1000000, 1000000, 5.2500, 7, 24,
     current_date, current_date + 30, current_date + 30 + (24 * 30),
     'Monthly', 'Fix Installment', null, 'Finance', 'Draft', 'KBANK-HP-0003',
     'ตัวอย่าง — ร่าง · รถยังมาไม่ถึง ใส่เลขตัวถัง 000 ไว้ก่อน');

  -- ── เช่า (Leasing) ──
  v_principal := 5000000; v_rate := 4.2500; v_term := 60;
  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, chassis_no, vendor, principal, annual_rate,
                      term_months, start_date, payment_start_date, end_date,
                      payment_frequency, payment_type, payment_timing, pay_eom,
                      upfront_payment, rou_useful_life, classification, status, bank_ref, remark)
  values ('SEED-LSE-001', 'SEED-LSE-2026-0001', current_date - 200, v_ca, 'lease', true,
          'ยานพาหนะ', 'รถผู้บริหาร BMW 530e (เช่าดำเนินงาน)', 'SEEDLSE00000001',
          'บริษัท ลีสซิ่ง จำกัด', v_principal, v_rate, v_term,
          current_date - 200, current_date - 170, current_date - 170 + (v_term * 30),
          'Monthly', 'Fix Installment', 'arrears', true,
          200000, 60, 'Finance', 'Active', 'KBANK-LSE-0001',
          'ตัวอย่าง — เช่า ใช้วงเงินธนาคาร มีเงินจ่ายล่วงหน้าวันแรก')
  returning id into v_lease;

  r := v_rate / 100 / 12;
  v_bal := v_principal - 200000;
  v_pmt := round(v_bal * r * power(1 + r, v_term) / (power(1 + r, v_term) - 1), 2);
  for i in 1..v_term loop
    v_due  := (current_date - 170) + ((i - 1) * interval '1 month');
    v_int  := round(v_bal * r, 2);
    v_prin := round(v_pmt - v_int, 2);
    if i = v_term then v_prin := v_bal; end if;
    insert into lease_schedules (lease_id, period, due_date, begin_balance, payment, interest, principal,
                                 end_balance, paid, paid_date)
    values (v_lease, i, v_due, v_bal, v_pmt, v_int, v_prin, v_bal - v_prin,
            v_due <= current_date, case when v_due <= current_date then v_due else null end);
    v_bal := v_bal - v_prin;
  end loop;

  -- ประวัติการปรับปรุงมูลค่าสัญญา 2 เวอร์ชัน
  insert into lease_versions (lease_id, version, effective_date, rou_asset, lease_liability,
                              annual_rate, term_months, pl_amount, reason) values
    (v_lease, 1, current_date - 200, 5000000, 4800000, 4.2500, 60,       0, 'มูลค่าตั้งต้นวันทำสัญญา'),
    (v_lease, 2, current_date -  40, 5350000, 5120000, 4.5000, 60, -180000, 'ต่ออายุสัญญาและปรับค่าเช่า');

  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, chassis_no, vendor, principal, annual_rate,
                      term_months, start_date, payment_start_date, end_date,
                      payment_frequency, payment_type, classification, status, bank_ref, remark) values
    ('SEED-LSE-002', 'SEED-LSE-2026-0002', current_date, v_ca, 'lease', true,
     'อุปกรณ์', 'เครื่องถ่ายเอกสารสำนักงาน (เช่า)', null, 'บริษัท ลีสซิ่ง จำกัด',
     600000, 5.0000, 36, current_date, current_date + 30, current_date + 30 + (36 * 30),
     'Monthly', 'Fix Installment', 'Finance', 'Draft', 'KBANK-LSE-0002', 'ตัวอย่าง — ร่าง'),
    ('SEED-LSE-003', 'SEED-LSE-2026-0003', current_date - 800, v_ca, 'lease', true,
     'ยานพาหนะ', 'รถตู้รับส่งพนักงาน (เช่า)', 'SEEDLSE00000003', 'บริษัท ลีสซิ่ง จำกัด',
     1800000, 4.7500, 24, current_date - 800, current_date - 770, current_date - 50,
     'Monthly', 'Fix Installment', 'Finance', 'Closed', 'KBANK-LSE-0003', 'ตัวอย่าง — ครบสัญญาแล้ว');

  -- ── เช่าอื่น (Leasing Other) — ไม่ใช้วงเงินธนาคาร ──
  v_principal := 9600000; v_rate := 4.6500; v_term := 60;
  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, vendor, principal, annual_rate, discount_rate,
                      term_months, start_date, payment_start_date, end_date,
                      payment_frequency, payment_type, payment_timing, pay_eom,
                      rou_useful_life, classification, status, remark)
  values ('SEED-LSO-001', 'SEED-LSO-2026-0001', current_date - 300, null, 'other', false,
          'อาคาร / ที่ดิน', 'สำนักงานใหญ่ ชั้น 12-14 อาคารพระราม 9', 'บริษัท ผู้ให้เช่าอาคาร จำกัด',
          v_principal, v_rate, v_rate, v_term,
          current_date - 300, current_date - 270, current_date - 270 + (v_term * 30),
          'Monthly', 'Fix Installment', 'advance', true, 60, 'Operating', 'Active',
          'ตัวอย่าง — เช่าอาคาร จ่ายต้นงวด ไม่ใช้วงเงินธนาคาร')
  returning id into v_lease;

  r := v_rate / 100 / 12;
  v_bal := v_principal;
  v_pmt := round((v_bal * r * power(1 + r, v_term) / (power(1 + r, v_term) - 1)) / (1 + r), 2);
  for i in 1..v_term loop
    v_due  := (current_date - 270) + ((i - 1) * interval '1 month');
    v_int  := case when i = 1 then 0 else round(v_bal * r, 2) end;
    v_prin := round(v_pmt - v_int, 2);
    if i = v_term then v_prin := v_bal; end if;
    insert into lease_schedules (lease_id, period, due_date, begin_balance, payment, interest, principal,
                                 end_balance, paid, paid_date)
    values (v_lease, i, v_due, v_bal, v_pmt, v_int, v_prin, v_bal - v_prin,
            v_due <= current_date, case when v_due <= current_date then v_due else null end);
    v_bal := v_bal - v_prin;
  end loop;

  -- เช่าอื่นที่ค่าเช่าไม่เท่ากันตลอดสัญญา
  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, vendor, principal, annual_rate, discount_rate,
                      term_months, start_date, payment_start_date, end_date,
                      payment_frequency, payment_type, rou_useful_life, rent_steps,
                      classification, status, remark)
  values ('SEED-LSO-002', 'SEED-LSO-2026-0002', current_date - 60, null, 'other', false,
          'สำนักงาน', 'โกดังเก็บรถ บางนา กม.21', 'บริษัท ผู้ให้เช่าคลังสินค้า จำกัด',
          5245452.48, 4.6500, 4.6500, 24,
          current_date - 60, current_date - 30, current_date - 30 + (24 * 30),
          'Monthly', 'Fix Installment', 24,
          '[{"fromPeriod":1,"toPeriod":12,"amount":200000},{"fromPeriod":13,"toPeriod":24,"amount":260000}]'::jsonb,
          'Operating', 'Active', 'ตัวอย่าง — ค่าเช่าปีแรก 200,000 ปีถัดไป 260,000');

  insert into leases (lease_no, contract_number, contract_date, ca_id, mode, use_bank_loan,
                      asset_type, asset_name, vendor, principal, annual_rate, discount_rate,
                      term_months, start_date, payment_start_date, end_date,
                      payment_frequency, payment_type, classification, status, remark)
  values ('SEED-LSO-003', 'SEED-LSO-2026-0003', current_date, null, 'other', false,
          'อุปกรณ์', 'เครื่องปรับอากาศสำนักงาน (เช่า)', 'บริษัท ผู้ให้เช่าอุปกรณ์ จำกัด',
          480000, 5.0000, 5.0000, 36,
          current_date, current_date + 30, current_date + 30 + (36 * 30),
          'Monthly', 'Fix Installment', 'Operating', 'Draft', 'ตัวอย่าง — ร่าง');
end $$;

-- =====================================================================
--  13. รายการเดินบัญชีธนาคาร (Bank Statement) — ใช้ตัดชำระ
-- =====================================================================
do $$
declare
  v_st uuid; i int; v_bal numeric := 12500000;
begin
  insert into bank_statements (finance_institution, account_no, statement_name, statement_period, source, remark)
  values ('KBANK', '140-3-02462-5', 'SEED-รายการเดินบัญชี กสิกร เดือนนี้',
          to_char(current_date, 'YYYY-MM'), 'Manual', 'ชุดข้อมูลตัวอย่าง')
  returning id into v_st;

  for i in 1..10 loop
    if i % 3 = 0 then
      v_bal := v_bal - 250000;
      insert into bank_statement_lines (statement_id, tx_date, txn_code, description, debit, credit, balance, sort_order)
      values (v_st, current_date - (10 - i), 'TRANSFER', 'ชำระค่างวดสัญญาเช่าซื้อ SEED-HP-001', 250000, 0, v_bal, i);
    else
      v_bal := v_bal + 180000;
      insert into bank_statement_lines (statement_id, tx_date, txn_code, description, debit, credit, balance, sort_order)
      values (v_st, current_date - (10 - i), 'ENET', 'รับชำระจากลูกค้า', 0, 180000, v_bal, i);
    end if;
  end loop;

  insert into bank_statements (finance_institution, account_no, statement_name, statement_period, source, remark)
  values ('SCB', '140-3-09999-1', 'SEED-รายการเดินบัญชี ไทยพาณิชย์ เดือนก่อน',
          to_char(current_date - 30, 'YYYY-MM'), 'Import', 'ชุดข้อมูลตัวอย่าง');
end $$;

-- =====================================================================
--  14. การชำระเงิน (Repayment) + รายการแยกประเภท
-- =====================================================================
do $$
declare
  v_pn uuid; v_loan uuid; v_lease uuid; v_rep uuid;
  v_ft_pn uuid; v_ft_loan uuid; v_ft_hp uuid;
begin
  select id into v_pn    from promissory_notes where name     = 'SEED-PN-003';
  select id into v_loan  from loans            where loan_no  = 'SEED-LOAN-001';
  select id into v_lease from leases           where lease_no = 'SEED-HP-001';
  select id into v_ft_pn   from facility_types where code = 'PN';
  select id into v_ft_loan from facility_types where code = 'LOAN';
  select id into v_ft_hp   from facility_types where code = 'HP';

  insert into repayments (repayment_no, facility_type, facility_type_id, facility_id, pay_date,
                          amount, principal, interest, fee, vat, wht, penalty,
                          channel, reference_no, status, remark)
  values ('SEED-REP-001', 'PN', v_ft_pn, v_pn, current_date - 120,
          10380000, 10000000, 380000, 0, 0, 0, 0,
          'Bank Statement', 'KBANK-REF-0001', 'Posted', 'ตัวอย่าง — ปิดตั๋วสัญญาใช้เงิน')
  returning id into v_rep;
  insert into repayment_lines (repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order) values
    (v_rep, 'PN', v_pn, 'SEED-PN-003', 'Principal', 10000000, 1),
    (v_rep, 'PN', v_pn, 'SEED-PN-003', 'Interest',    380000, 2);

  insert into repayments (repayment_no, facility_type, facility_type_id, facility_id, pay_date,
                          amount, principal, interest, channel, reference_no, status, remark)
  values ('SEED-REP-002', 'Loan', v_ft_loan, v_loan, current_date - 30,
          686250, 570000, 116250, 'Bank Statement', 'KTB-REF-0002', 'Posted', 'ตัวอย่าง — ค่างวดเงินกู้')
  returning id into v_rep;
  insert into repayment_lines (repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order) values
    (v_rep, 'Loan', v_loan, 'SEED-LOAN-001', 'Principal', 570000, 1),
    (v_rep, 'Loan', v_loan, 'SEED-LOAN-001', 'Interest',  116250, 2);

  insert into repayments (repayment_no, facility_type, facility_type_id, facility_id, pay_date,
                          amount, principal, interest, vat, channel, reference_no, status, remark)
  values ('SEED-REP-003', 'HP', v_ft_hp, v_lease, current_date - 15,
          58432, 45000, 9600, 3832, 'Bank Statement', 'KBANK-REF-0003', 'Posted', 'ตัวอย่าง — ค่างวดเช่าซื้อ')
  returning id into v_rep;
  insert into repayment_lines (repayment_id, facility_type, facility_id, contract_label, category, amount, sort_order) values
    (v_rep, 'HP', v_lease, 'SEED-HP-001', 'Principal', 45000, 1),
    (v_rep, 'HP', v_lease, 'SEED-HP-001', 'Interest',   9600, 2),
    (v_rep, 'HP', v_lease, 'SEED-HP-001', 'Fee',        3832, 3);

  insert into repayments (repayment_no, facility_type, facility_type_id, facility_id, pay_date,
                          amount, principal, interest, channel, status, remark)
  values ('SEED-REP-004', 'Loan', v_ft_loan, v_loan, current_date,
          686250, 572000, 114250, 'Bank Statement', 'Draft', 'ตัวอย่าง — ร่าง ยังไม่ลงบัญชี');
end $$;

-- =====================================================================
--  15. ใบสำคัญบัญชี (Journal Entry) ตัวอย่าง
-- =====================================================================
do $$
declare
  v_lease uuid; v_je uuid;
begin
  select id into v_lease from leases where lease_no = 'SEED-HP-001';

  insert into journal_entries (je_number, source_type, source_id, je_date, posting_period, description,
                               total_dr, total_cr, status, posted_by, posted_at, sync_status)
  values ('SEED-JE-0001', 'LEASE_DAY1', v_lease, current_date - 150,
          to_char(current_date - 150, 'Mon YYYY'), 'ลงบัญชีวันแรก — SEED-HP-001',
          2856000, 2856000, 'Posted', 'seed', now(), 'synced')
  returning id into v_je;
  insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
    (v_je, 1, '1240100', 'Right-of-Use Asset',                    2400000,       0, 'สินทรัพย์ตามสัญญาเช่าซื้อ'),
    (v_je, 2, '240000',  'Deferred Interest',                      288000,       0, 'ดอกเบี้ยรอตัดบัญชี'),
    (v_je, 3, '119601',  'Undue Input VAT — Lease',                168000,       0, 'ภาษีซื้อรอตัดบัญชี'),
    (v_je, 4, '230000',  'Long-term Lease Liability',                    0, 2856000, 'หนี้สินตามสัญญาเช่าซื้อ');

  insert into journal_entries (je_number, source_type, source_id, source_period, je_date, posting_period,
                               description, total_dr, total_cr, status, posted_by, posted_at, sync_status)
  values ('SEED-JE-0002', 'LEASE_PAY', v_lease, 1, current_date - 120,
          to_char(current_date - 120, 'Mon YYYY'), 'ลงบัญชีค่างวดที่ 1 — SEED-HP-001',
          58432, 58432, 'Posted', 'seed', now(), 'pending')
  returning id into v_je;
  insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
    (v_je, 1, '280000',  'Current Portion of Lease Liability', 45000,     0, 'ตัดเงินต้น'),
    (v_je, 2, '610000',  'Lease Interest Expense',              9600,     0, 'ดอกเบี้ยจ่าย'),
    (v_je, 3, '119601',  'Undue Input VAT — Lease',             3832,     0, 'ภาษีซื้อ'),
    (v_je, 4, '212010',  'AP — Leasing Co.',                        0, 58432, 'เจ้าหนี้ค่างวด');

  insert into journal_entries (je_number, source_type, je_date, posting_period, description,
                               total_dr, total_cr, status)
  values ('SEED-JE-0003', 'MANUAL', current_date, to_char(current_date, 'Mon YYYY'),
          'ใบสำคัญตัวอย่าง — ยังไม่ลงบัญชี', 100000, 100000, 'Draft')
  returning id into v_je;
  insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description) values
    (v_je, 1, '5511101', 'ค่าธรรมเนียมธนาคาร', 100000,      0, 'ค่าธรรมเนียม'),
    (v_je, 2, '100000',  'Cheque Account',           0, 100000, 'จ่ายจากบัญชีกระแสรายวัน');
end $$;

-- =====================================================================
--  16. ตารางผ่อนกลาง — ใช้ทำรายงานครบกำหนด / ค้างชำระ และแจ้งเตือน
-- =====================================================================
insert into installment_schedules (facility_type_id, facility_id, contract_no, period, due_date,
                                   begin_balance, principal, interest, payment, end_balance,
                                   paid, paid_date, paid_amount)
select (select id from facility_types where code = 'LOAN'),
       s.loan_id, 'SEED-LOAN-001', s.period, s.due_date,
       s.begin_balance, s.principal, s.interest, s.payment, s.end_balance,
       s.paid, s.paid_date, case when s.paid then s.payment else 0 end
from loan_schedules s
join loans l on l.id = s.loan_id
where l.loan_no = 'SEED-LOAN-001';

insert into installment_schedules (facility_type_id, facility_id, contract_no, period, due_date,
                                   begin_balance, principal, interest, vat, payment, end_balance,
                                   chassis_no, paid, paid_date, paid_amount)
select (select id from facility_types where code = 'HP'),
       s.lease_id, 'SEED-HP-001', s.period, s.due_date,
       s.begin_balance, s.principal, s.interest, s.vat, s.payment, s.end_balance,
       l.chassis_no, s.paid, s.paid_date, case when s.paid then s.payment else 0 end
from lease_schedules s
join leases l on l.id = s.lease_id
where l.lease_no = 'SEED-HP-001';

-- =====================================================================
--  สรุปผล
-- =====================================================================
select 'สัญญาหลัก (MA)'        as รายการ, count(*) as จำนวน from master_agreements where ma_name      like 'SEED-%'
union all select 'วงเงิน (CA)',          count(*) from credit_agreements where ca_name      like 'SEED-%'
union all select 'ตั๋วสัญญาใช้เงิน',      count(*) from promissory_notes  where name         like 'SEED-%'
union all select 'หนังสือค้ำประกัน',      count(*) from letter_guarantees where lg_no        like 'SEED-%'
union all select 'เลตเตอร์ออฟเครดิต',    count(*) from letters_of_credit where lc_no        like 'SEED-%'
union all select 'สินเชื่อค้าดีลเลอร์',    count(*) from floor_plans      where fp_no        like 'SEED-%'
union all select 'เบิกเกินบัญชี',         count(*) from overdrafts       where od_no        like 'SEED-%'
union all select 'ทรัสต์รีซีท',           count(*) from trust_receipts   where tr_no        like 'SEED-%'
union all select 'สัญญาซื้อขายเงินตราล่วงหน้า', count(*) from fx_forwards where fxf_no      like 'SEED-%'
union all select 'เงินกู้',               count(*) from loans            where loan_no      like 'SEED-%'
union all select 'สัญญาเช่า (3 ชนิด)',    count(*) from leases           where lease_no     like 'SEED-%'
union all select 'การชำระเงิน',           count(*) from repayments       where repayment_no like 'SEED-%'
union all select 'ใบสำคัญบัญชี',          count(*) from journal_entries  where je_number    like 'SEED-%'
union all select 'รถในทะเบียนกลาง',       count(*) from vehicles         where chassis_no   like 'SEED%';
