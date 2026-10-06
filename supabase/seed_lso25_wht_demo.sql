-- ============================================================
-- Seed: LSO-25 — ภาษีหัก ณ ที่จ่าย 3% (Lease Other · ทำที่ NetSuite AP)
--
--   LSO-DEMO-25 (mode=other · ca_id NULL · Active) · PRINCIPAL 800,000 · 4% · 36 งวด
--   ใบสำคัญค่าเช่ารายงวด: Cr เจ้าหนี้ผู้ให้เช่า (AP) ยอดเต็ม
--     · ไม่มีบรรทัดแยก WHT 3% ในใบสำคัญนี้
--     · บรรทัด Cr มีคำอธิบาย "ส่งไป NetSuite AP Module — WHT 3% applied at AP"
--
-- วิธีทดสอบ LSO-25:
--   เปิด LSO-DEMO-25 → ลงบัญชีวันแรก → ลงบัญชีค่าเช่ารายงวด → เปิดใบสำคัญดูบรรทัด Cr เจ้าหนี้
--
-- *** สำคัญ: ปุ่ม "📋 ลงบัญชีงวดนี้" กดได้เฉพาะงวดที่ "ถึงกำหนดแล้ว" (วันครบงวด ≤ วันนี้)
--     งวดอนาคตปุ่มจะจาง tooltip "ยังไม่ถึงกำหนด" — จึงตั้ง payment_start_date = 31/05/2026
--     เพื่อให้งวด 1–5 (พ.ค.–ก.ย. 2026) ถึงกำหนดแล้ว กดลงบัญชีได้ทันที
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9ea50-0000-0000-0000-000000005025' or lease_no = 'LSO-DEMO-25';

insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, contract_number, contract_date, classification,
   payment_frequency, payment_start_date, end_date, payment_type, asset_type, asset_name,
   chassis_no, vendor, vehicle_price, down_payment, net_vehicle_cost, principal,
   annual_rate, term_months, start_date, balloon_amount, balloon_pattern, upfront_payment,
   grace_periods, prepaid_periods, prepaid_amount, discount_rate, rou_useful_life, vat_rate,
   posting_lease, calc_interest_end, include_balloon_installment, pay_eom, rent_steps,
   acct_cards, rollover_parent_id, status, remark, bank_ref, created_at, updated_at)
values
  ('d9d9ea50-0000-0000-0000-000000005025','LSO-DEMO-25',null,'MGC','other',
   false,'LSO25-CONTRACT', date '2026-05-01','Operating',
   'Monthly', date '2026-05-31', date '2029-05-30','ชำระปลายงวด (End of Period)','อาคาร','อาคารสำนักงาน ชั้น 7',
   null,'บจก. ผู้ให้เช่าอาคาร เดโม',null,null,null,800000,
   4,36, date '2026-05-01',0,'with-last',0,
   0,0,0,4,36,7,
   true,false,true,true, null,
   '[{"id":"ac-1","type":"RIGHT-OF-USE ASSET","gl":"1431104 สิทธิการใช้สินทรัพย์ - ยานพาหนะ"},
     {"id":"ac-2","type":"LEASE LIABILITY","gl":"2322104 หนี้สินตามสัญญาเช่า ROU-ยานพาหนะ"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5513104 ดอกเบี้ยจ่าย ROU-ยานพาหนะ"},
     {"id":"ac-4","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-5","type":"DEPRECIATION EXPENSE - ROU","gl":"5435304 ค่าเสื่อมราคา ROU-ยานพาหนะ"},
     {"id":"ac-6","type":"ACCUMULATED DEPRECIATION - ROU","gl":"1432106 ค่าเสื่อมราคาสะสมฯ(HP)"},
     {"id":"ac-7","type":"GAIN(LOSS) ON MODIFICATION","gl":"4929101 รายได้อื่น (ชั่วคราว)"},
     {"id":"ac-8","type":"AP LEASE ACCOUNT","gl":"2129102 บัญชีพักเจ้าหนี้-สัญญาเช่าซื้อ"}]'::jsonb,
   null,'Active','seed LSO-25 · Lease Other · ค่าเช่างวด → Cr เจ้าหนี้ยอดเต็ม · WHT 3% หักที่ NetSuite AP','BANKREF-LSO25', now(), now());

-- ตรวจผล
select lease_no, mode, use_bank_loan, status, principal
  from leases where id = 'd9d9ea50-0000-0000-0000-000000005025';
-- คาดหวัง: mode=other · use_bank_loan=false → ใบค่าเช่างวด Cr เจ้าหนี้ (AP) · WHT 3% ที่ NetSuite
