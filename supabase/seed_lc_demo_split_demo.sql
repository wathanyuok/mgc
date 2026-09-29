-- ============================================================
-- Seed: LC-DEMO-001 + Sub-LC (การรับมอบแบบทยอย / LC Split)
--   parent = LC-DEMO-001 (d9d9f000-...f3) · USD 100,000 @35 = 3,500,000 · fee 1% · DOL 60
-- ทำให้:
--   • parent เป็น Active (ปุ่ม "+ รับมอบ Lot" กดได้ · เดิม Draft เลยเทา)
--   • รับมอบแล้ว 2 lot (sub-LC ผูก parent_lc_id):
--       S1 : USD 40,000 = 1,400,000 · arrival 20/09/2026 · expiry +60 = 19/11/2026 · fee 14,000 · Active
--       S2 : USD 30,000 = 1,050,000 · arrival 05/10/2026 · expiry +60 = 04/12/2026 · fee 10,500 · Draft (รออนุมัติ)
--   • parent เหลือ "คงเหลือรอรับ" = USD 30,000 = 1,050,000  ← เว้นไว้ให้ลองกด "+ รับมอบ Lot" เอง
--       ยอดตาม LC 100,000 = รับแล้ว 70,000 + คงเหลือ 30,000
-- fee sub = amount × fee_rate% (full_term) · lc_no = {parent}-S{n} (ตรงกับที่ระบบ generate)
-- ต้องรัน seed_lc_fp_od_tr_fxf_demo.sql ก่อน (ให้มี LC-DEMO-001 + ca ...c3)
-- FIELD ครบทุกช่อง (คอลัมน์ชุดเดียวกับ parent) · รันซ้ำได้
-- หมายเหตุ: ตาราง Fee ของแต่ละ sub (installment_schedules) ระบบ generate ตอนสร้างจริง
--           seed นี้ใส่เฉพาะสัญญา sub-LC · เปิด sub แล้วกด sync/บันทึกจะได้ตาราง fee เอง
-- ============================================================

-- ① ลบ sub-LC เดิม (รันซ้ำได้)
delete from letters_of_credit
 where parent_lc_id = 'd9d9f000-0000-0000-0000-0000000000f3'
    or lc_no like 'LC-DEMO-001-S%';

-- ② ตั้ง parent เป็น Active + ลดยอดเหลือ "คงเหลือรอรับ" 30,000 (ถูกยกไป sub แล้ว 70,000)
update letters_of_credit
   set status         = 'Active',
       amount_foreign = 30000,
       amount         = 1050000,
       updated_at     = now()
 where id = 'd9d9f000-0000-0000-0000-0000000000f3';

-- ③ Sub-LC · field ครบทุกช่อง (คอลัมน์ชุดเดียวกับ parent insert)
insert into letters_of_credit
  (id, lc_no, name, ca_id, finance_institution, lc_type, beneficiary, applicant, currency, amount_foreign, conversion_rate, amount,
   issue_date, expiry_date, transaction_date, term_days, estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount, reference_fxf_id, parent_lc_id, reference_contract, shared_limit_with_tr,
   converted_tr_id, conversion_date, settlement_date, settlement_amount, settlement_fx_rate, closed_date, close_rate_type, close_rate,
   status, remark, rate_cards, acct_cards, created_by, updated_by, created_at, updated_at)
values
  -- S1 : lot รับมอบแล้ว (Active) · 40,000 USD
  ('d9d9f000-0000-0000-0000-000000000fa1','LC-DEMO-001-S1','L/C เดโม (Lot 1)','d9d9f000-0000-0000-0000-0000000000c3','BBL','LC',
   'ABC Trading Co., Ltd.','MGC Asia','USD',40000,35,1400000,
   date '2026-09-20', date '2026-11-19', date '2026-09-20',60, date '2026-09-20', date '2026-09-20',60,
   'full_term',1,0,14000,null,'d9d9f000-0000-0000-0000-0000000000f3','REF-LC-CONTRACT-001',false,
   null,null,null,null,null,null,null,null,
   'Active','seed sub-LC · lot 1 · USD 40,000 @35 = 1,400,000 · fee 1% = 14,000 · Expiry = Arrival(20/09)+60',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้ L/C"},{"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1), now(), now()),
  -- S2 : lot รับมอบแล้ว (Draft — รออนุมัติ) · 30,000 USD
  ('d9d9f000-0000-0000-0000-000000000fa2','LC-DEMO-001-S2','L/C เดโม (Lot 2)','d9d9f000-0000-0000-0000-0000000000c3','BBL','LC',
   'ABC Trading Co., Ltd.','MGC Asia','USD',30000,35,1050000,
   date '2026-10-05', date '2026-12-04', date '2026-10-05',60, date '2026-10-05', date '2026-10-05',60,
   'full_term',1,0,10500,null,'d9d9f000-0000-0000-0000-0000000000f3','REF-LC-CONTRACT-001',false,
   null,null,null,null,null,null,null,null,
   'Draft','seed sub-LC · lot 2 · USD 30,000 @35 = 1,050,000 · fee 1% = 10,500 · Expiry = Arrival(05/10)+60 · รออนุมัติ',
   '[]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},{"id":"ac-3","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้ L/C"},{"id":"ac-4","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},{"id":"ac-5","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1), now(), now());

-- ④ ตรวจผล — parent + subs
select 'PARENT' as role, lc_no, status, amount_foreign, amount, parent_lc_id
  from letters_of_credit where id = 'd9d9f000-0000-0000-0000-0000000000f3'
union all
select 'SUB', lc_no, status, amount_foreign, amount, parent_lc_id
  from letters_of_credit where parent_lc_id = 'd9d9f000-0000-0000-0000-0000000000f3'
 order by role desc, lc_no;
-- คาดหวัง: ยอดตาม LC 100,000 = SUB(40,000+30,000)=70,000 + PARENT คงเหลือ 30,000
