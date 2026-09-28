-- ============================================================
-- Seed: LSO-22 — Leasing Other · ฐานทดสอบ "ช่วงงวดไม่ถูกต้อง" (rent steps validation) · FIELD ครบทุกช่อง
-- สร้างสัญญาที่ช่วงงวด "ถูกต้อง" ไว้ก่อน (1-6, 7-12 ครอบ 12 งวด)
-- แล้ว tester แก้ช่วงให้ผิด (ไม่เริ่ม 1 / ไม่ต่อเนื่อง / ไม่จบที่ 12 / ค่าเช่า 0) เพื่อดู error
--
-- term 12 · discount 5% · payment_type = ชำระปลายงวด (arrears)
-- PRINCIPAL (readOnly) = NPV = 612,899.89 (งวด 1-6=50,000 · 7-12=55,000)
--
-- Lease Other ไม่ใช้วงเงินธนาคาร → ไม่ต้องผูก CA/MA · ตั้ง subsidiary ตรง = 'MGC'
-- รันซ้ำได้ (upsert vendor · ลบ lease ด้วย lease_no + id)
-- ============================================================

-- ① Vendor (ผู้ให้เช่า / Lessor) · ครบ field · upsert
insert into vendors
  (id, code, name, tax_id, vendor_type, netsuite_vendor_id,
   contact_email, contact_phone, address, remark, active,
   created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-000000001522', 'LESSOR-DEMO-01', 'บริษัท ให้เช่าอสังหาริมทรัพย์ จำกัด',
   '0105551234567', null, 'NS-VENDOR-LESSOR-01',
   'contact@lessor-demo.co.th', '02-000-0000', '123 อาคาร A ถนนสุขุมวิท กรุงเทพฯ 10110',
   'seed · ผู้ให้เช่า (Lessor) สำหรับ Leasing Other', true,
   now(), now())
on conflict (code) do update set
  name = excluded.name, tax_id = excluded.tax_id,
  netsuite_vendor_id = excluded.netsuite_vendor_id,
  contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
  address = excluded.address, remark = excluded.remark, active = excluded.active,
  updated_at = now();

-- ② Lease Other · ครบทุก field (ช่วงงวดตั้งไว้ถูกต้อง — tester แก้ให้ผิดเองเพื่อทดสอบ)
delete from leases
 where lease_no = 'LSO-DEMO-INVALID-001'
    or id = 'd9d90000-0000-0000-0000-00000000152a';

insert into leases
  (id, lease_no, ca_id, mode, use_bank_loan,
   asset_type, asset_name, vendor, vendor_id,
   vehicle_price, down_payment, net_vehicle_cost,
   principal, annual_rate, discount_rate, term_months,
   start_date, payment_start_date, end_date, contract_date, contract_number,
   balloon_amount, balloon_pattern, include_balloon_installment,
   upfront_payment, prepaid_periods, prepaid_amount, grace_periods,
   vat_rate, classification, payment_frequency, payment_type,
   posting_lease, inactive, calc_interest_end, pay_eom,
   acct_cards, rent_steps, rou_useful_life, chassis_no, bank_ref, tfrs16_exemption,
   rollover_parent_id, subsidiary,
   remeasure_requested_by, remeasure_requested_at,
   status, remark, created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-00000000152a', 'LSO-DEMO-INVALID-001', null, 'other', false,
   'อาคาร', 'อาคารสำนักงานให้เช่า ชั้น 11 อาคาร A',
   'บริษัท ให้เช่าอสังหาริมทรัพย์ จำกัด', 'd9d90000-0000-0000-0000-000000001522',
   null, null, null,
   612899.89, 0, 5.0000, 12,
   date '2026-09-01', date '2026-09-01', date '2027-08-31', date '2026-09-01', 'LSO-CTR-2026-002',
   null, null, true,
   0, 0, 0, 0,
   7, 'Operating', 'Monthly', 'ชำระปลายงวด (End of Period)',
   true, false, false, true,
   '[]'::jsonb,
   '[{"fromPeriod":1,"toPeriod":6,"amount":50000},{"fromPeriod":7,"toPeriod":12,"amount":55000}]'::jsonb,
   null, 'ASSET-BLDG-A-FL11', null, null,
   null, 'MGC',
   null, null,
   'Draft', 'seed LSO-22 · ฐานทดสอบช่วงงวดไม่ถูกต้อง (แก้ช่วงให้ผิดเพื่อดู error)', now(), now());

-- ตรวจ: เปิด LSO-DEMO-INVALID-001 → ตาราง "ค่าเช่าแยกตามช่วงงวด" ถูกต้อง (1-6, 7-12)
--   ทดสอบแก้ให้ผิดแล้วดู error ใต้ตาราง + กด Save ไม่ผ่าน:
--     • งวดที่เริ่มช่วงแรก = 2      → "ช่วงแรกต้องเริ่มที่งวดที่ 1"
--     • ถึงงวดที่ < งวดที่เริ่ม       → "ช่วงที่ N งวดสิ้นสุดน้อยกว่างวดเริ่ม"
--     • ช่วง 2 เริ่ม 8 (ข้าม 7)     → "ช่วงงวดไม่ต่อเนื่อง — ช่วงที่ 2 ควรเริ่มที่งวดที่ 7"
--     • ช่วงสุดท้ายจบ 10 (ไม่ใช่ 12) → "ช่วงสุดท้ายควรจบที่งวดที่ 12 (อายุสัญญา) — ตอนนี้จบที่ 10"
--     • ค่าเช่าต่อเดือน = 0          → "ยังมีช่วงที่ยังไม่ได้ใส่ค่าเช่า"
