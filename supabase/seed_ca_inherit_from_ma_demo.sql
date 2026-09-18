-- ============================================================
-- Seed: CA-15 / 15A / 15B — ดึง Condition · Collateral · Guarantee จากสัญญาหลัก
-- สร้าง Master Agreement (Approved) ที่มีข้อมูลครบทั้ง 3 แท็บ
-- → พอสร้าง "วงเงินใหม่ (CA)" แล้วเลือกสัญญาหลักใบนี้
--   แท็บ Condition / Collateral / Guarantee จะถูกเติมให้ + ขึ้นแถบสีฟ้า
--   "🔗 ดึงจาก Master Agreement — แก้ไขที่นี่จะ override เฉพาะ CA นี้ (ไม่กระทบ MA)"
--
-- ทดสอบ: เมนู Credit Agreement → New → เลือก CREDIT AGREEMENT NAME (สัญญาหลัก)
--   = "MA-DEMO-INHERIT" → เปิดแท็บ Condition / Collateral / Guarantee ทีละแท็บ
-- ============================================================
begin;

-- ล้างของเดิม (ครอบ id + ชื่อ) — child tables (conditions/collaterals/guarantors/subsidiaries)
-- ผูก ON DELETE CASCADE อยู่แล้ว ลบ MA ใบเดียวก็ล้างลูกทั้งหมด
delete from master_agreements
 where ma_name = 'MA-DEMO-INHERIT'
    or id = 'aaaaaaaa-dddd-eeee-ffff-000000ca0015';

-- Master Agreement (Approved — ต้อง Approved ถึงจะเลือกใน dropdown ของ CA ได้)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'KBANK', 'MA-DEMO-INHERIT', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 20000000, 0);

-- หมายเหตุผู้ค้ำ (แสดงท้ายแท็บ Guarantee — ดึงมาด้วย)
update master_agreements
   set guarantee_remark = 'ค้ำแบบ Joint and Several ทุกราย · ผูกพันจนกว่าจะปิดวงเงิน'
 where id = 'aaaaaaaa-dddd-eeee-ffff-000000ca0015';

-- จัดสรรวงเงินให้บริษัทย่อย MGC — เพื่อให้ตอน Save CA ผ่านด่าน "ได้รับจัดสรรวงเงิน"
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'MGC', 20000000, 0, 0);

-- ── แท็บ Condition ─────────────────────────────────────────
insert into ma_conditions
  (ma_id, de_op, de_value, dscr_op, dscr_value, other_requirement, consent_waiver)
values
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015',
   '<=', 2.00, '>=', 1.25,
   'คงอัตราส่วนสภาพคล่อง (Current Ratio) ไม่ต่ำกว่า 1.0 · นำส่งงบการเงินตรวจสอบภายใน 120 วันหลังปิดงวด',
   'ผ่อนผันการดำรงอัตราส่วน D/E ได้ถึงสิ้นปี 2026 · ต้องขอความยินยอมก่อนก่อหนี้เพิ่มกับสถาบันการเงินอื่น');

-- ── แท็บ Collateral (3 รายการ: อสังหา · รถ · เงินฝาก) ───────
insert into ma_collaterals
  (ma_id, type, asset_no, doc_no, location, value, appraisal, appr_date, mortgage_limit,
   chassis_no, vreg, vmodel, pledge, bank, acct_no, acct_name, deposit_amt, pledge_amt,
   source, fields, sort_order)
values
  -- 1) ที่ดิน/อสังหาริมทรัพย์
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'realestate',
   'FA-RE-001', 'นส.3ก เลขที่ 12345', 'ถ.สุขุมวิท แขวงคลองเตย กทม.',
   15000000, 18000000, date '2026-01-15', 20000000,
   null, null, null, null, null, null, null, null, null,
   'manual',
   '{"asset_no":"FA-RE-001","doc_no":"นส.3ก เลขที่ 12345","location":"ถ.สุขุมวิท แขวงคลองเตย กทม.","value":15000000,"appraisal":18000000,"appr_date":"2026-01-15","mortgage_limit":20000000}'::jsonb,
   0),
  -- 2) ยานพาหนะ
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'vehicle',
   'FA-VH-002', null, null, 1200000, 1200000, date '2026-02-01', null,
   'MDEMOCHASSIS0015', '1กก-1234', 'Toyota Camry 2.5 HEV ปี 2025', 1000000,
   null, null, null, null, null,
   'manual',
   '{"asset_no":"FA-VH-002","chassis_no":"MDEMOCHASSIS0015","vreg":"1กก-1234","vmodel":"Toyota Camry 2.5 HEV ปี 2025","value":1200000,"appraisal":1200000,"appr_date":"2026-02-01","pledge":1000000}'::jsonb,
   1),
  -- 3) เงินฝากธนาคาร
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'deposit',
   null, null, null, null, null, null, null,
   null, null, null, null,
   'KBANK', '111-2-33333-4', 'บจก. เอ็มจีซี เอเชีย', 5000000, 5000000,
   'manual',
   '{"bank":"KBANK","acct_no":"111-2-33333-4","acct_name":"บจก. เอ็มจีซี เอเชีย","deposit_amt":5000000,"pledge_amt":5000000}'::jsonb,
   2);

-- ── แท็บ Guarantee (2 ราย: บุคคล · นิติบุคคล) ───────────────
insert into ma_guarantors
  (ma_id, type, name, company_name, id_card_or_tax_id, position, amount, expiry_date, phone, address, remark, sort_order)
values
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'บุคคลค้ำประกัน',
   'นายสมชาย ใจดี', null, '1103700123456', 'กรรมการผู้จัดการ',
   10000000, date '2027-12-31', '081-234-5678', '99/1 ถ.พระราม 9 กทม.', 'ค้ำเต็มวงเงิน', 0),
  ('aaaaaaaa-dddd-eeee-ffff-000000ca0015', 'นิติบุคคลค้ำประกัน',
   null, 'บริษัท ค้ำประกันมั่นคง จำกัด', '0105551234567', null,
   10000000, date '2027-12-31', '02-111-2222', '1 อาคารมั่นคง ถ.สีลม กทม.', 'นิติบุคคลในเครือ', 1);

commit;

-- ตรวจ: Credit Agreement → New → CREDIT AGREEMENT NAME = "MA-DEMO-INHERIT"
--   แท็บ Condition  → D/E 2.00 · DSCR 1.25 · Other Requirement · Consent/Waiver ถูกเติม + แถบ 🔗
--   แท็บ Collateral → 3 การ์ด (อสังหา/รถ/เงินฝาก) + แถบ 🔗
--   แท็บ Guarantee  → 2 ราย + หมายเหตุท้ายแท็บ + แถบ 🔗
