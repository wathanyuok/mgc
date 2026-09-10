-- Seed: PN demo สำหรับทดสอบ PN-17 (ดอกเบี้ยหลายอัตราในสัญญาเดียว)
-- เงินต้น 1,000,000 · 01/07/2026 → 30/09/2026 (91 วัน · 3 งวดตามสิ้นเดือน)
-- อัตราใบที่ 1: 5.00% เริ่ม 01/07/2026
-- อัตราใบที่ 2: 6.00% เริ่ม 16/08/2026 (วันกลางสัญญา — ตกอยู่ในงวดที่ 2)
-- คาดหวัง: งวด 2 (31/07→31/08) แบ่งคิด 16 วัน×5% + 15 วัน×6% = 4,657.53
-- ดูผลที่แท็บ Schedule Calculate · รันซ้ำได้ (ลบของเดิมชื่อเดียวกันก่อน)

delete from promissory_notes where pn_number = 'PN-DEMO-MR-001';

insert into promissory_notes
  (name, pn_number, finance_institution, facility_type_id, transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('PN-DEMO-MULTIRATE', 'PN-DEMO-MR-001', 'BBL',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-07-01', '2026-09-30', 91, 1000000, 'THB', 'Draft',
   '[
      {"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-07-01"},
      {"id":"rc-2","type":"Fixed","rate":6,"condition":0,"overlimit":0,"start_date":"2026-08-16"}
    ]'::jsonb);
