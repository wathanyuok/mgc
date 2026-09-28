-- ============================================================
-- Seed: LSO-21 — Leasing Other · ค่าเช่าแยกตามช่วงงวด (rent steps) · FIELD ครบทุกช่อง
-- Lease Other (Active) · term 12 · ค่าเช่า งวด 1-6 = 50,000 · งวด 7-12 = 55,000
-- discount rate 5% → PRINCIPAL (readOnly) = NPV = 612,899.89 (คำนวณอัตโนมัติจาก rent steps)
--
-- Lease Other ไม่ใช้วงเงินธนาคาร (use_bank_loan=false) → ไม่ต้องผูก CA/MA
--   แต่ต้องมี subsidiary ตรงๆ (เลือกเองในฟอร์ม) → ตั้ง 'MGC'
--
-- ทดสอบ: เปิด Lease Other → LSO-DEMO-RENT-001
--   MODE = "Leasing Other" (readonly) · ตาราง "ค่าเช่าแยกตามช่วงงวด" 2 แถว
--   PRINCIPAL AMOUNT อ่านอย่างเดียว (พื้นเทา) = มูลค่าปัจจุบันของค่าเช่า
--
-- รันซ้ำได้ (ลบด้วย lease_no + id)
-- ============================================================

-- ① Vendor (ผู้ให้เช่า / Lessor) · ครบ field · upsert เพื่อผูกกับ LESSOR ในสัญญา
insert into vendors
  (id, code, name, tax_id, vendor_type, netsuite_vendor_id,
   contact_email, contact_phone, address, remark, active,
   created_at, updated_at)
values
  ('d9d90000-0000-0000-0000-000000001522', 'LESSOR-DEMO-01', 'บริษัท ให้เช่าอสังหาริมทรัพย์ จำกัด',
   '0105551234567', null, 'NS-VENDOR-LESSOR-01',
   'contact@lessor-demo.co.th', '02-000-0000', '123 อาคาร A ถนนสุขุมวิท กรุงเทพฯ 10110',
   'seed LSO-21 · ผู้ให้เช่า (Lessor) สำหรับ Leasing Other', true,
   now(), now())
on conflict (code) do update set
  name = excluded.name, tax_id = excluded.tax_id,
  netsuite_vendor_id = excluded.netsuite_vendor_id,
  contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
  address = excluded.address, remark = excluded.remark, active = excluded.active,
  updated_at = now();

-- ② Lease Other
delete from leases
 where lease_no = 'LSO-DEMO-RENT-001'
    or id = 'd9d90000-0000-0000-0000-000000001521';

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
  ('d9d90000-0000-0000-0000-000000001521', 'LSO-DEMO-RENT-001', null, 'other', false,
   'อาคาร', 'อาคารสำนักงานให้เช่า ชั้น 10 อาคาร A',
   'บริษัท ให้เช่าอสังหาริมทรัพย์ จำกัด', 'd9d90000-0000-0000-0000-000000001522',
   null, null, null,
   612899.89, 0, 5.0000, 12,
   date '2026-09-01', date '2026-09-01', date '2027-08-31', date '2026-09-01', 'LSO-CTR-2026-001',
   null, null, true,
   0, 0, 0, 0,
   7, 'Operating', 'Monthly', 'Fix Installment',
   true, false, false, true,
   '[]'::jsonb,
   '[{"fromPeriod":1,"toPeriod":6,"amount":50000},{"fromPeriod":7,"toPeriod":12,"amount":55000}]'::jsonb,
   null, 'ASSET-BLDG-A-FL10', null, null,
   null, 'MGC',
   null, null,
   'Active', 'seed LSO-21 · Leasing Other + ค่าเช่าแยกช่วงงวด (rent steps)', now(), now());

-- ตรวจ: เปิด LSO-DEMO-RENT-001 → ตาราง "ค่าเช่าแยกตามช่วงงวด" งวด 1-6=50,000 · 7-12=55,000
--   PRINCIPAL AMOUNT (readOnly พื้นเทา) = 612,899.89 (= NPV คำนวณให้อัตโนมัติ)
--   คำใบ้ใต้ช่อง "= มูลค่าปัจจุบันของค่าเช่าตามช่วงด้านล่าง"
