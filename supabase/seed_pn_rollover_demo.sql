-- Seed: PN demo สำหรับทดสอบ PN-51 (ต่อสัญญาเกินจำนวนครั้งที่วงเงินกำหนด)
--
-- สร้าง:
--   1) วงเงิน (CA) Revolving · MAXIMUM ROLL OVER (TIMES) = 2 · status Approved
--   2) โซ่ตั๋ว 3 ใบ ต่อสัญญากันมา 2 ครั้งแล้ว:
--        PN-RO-DEMO-000 (ต้นฉบับ) → PN-RO-DEMO-001 (ต่อครั้งที่ 1) → PN-RO-DEMO-002 (ต่อครั้งที่ 2, Active)
--
-- ทดสอบ: เปิด PN-RO-DEMO-002 → กดปุ่ม "Roll Over" (มุมขวาบน) → กรอก Maturity ใหม่
--   ครั้งถัดไป = ครั้งที่ 3 > เพดาน 2 → ใน Modal ขึ้นกล่องแดง
--   "ทำรายการไม่ได้ — เกิน Maximum Roll Over (2 ครั้ง จาก CA)" · ปุ่ม Confirm Roll Over กดไม่ได้
--
-- หมายเหตุ: ปุ่ม Roll Over ต้อง login เป็นผู้ที่มีสิทธิ์ approve P/N ด้วย (สิทธิ์ผู้ใช้ seed ไม่ได้)
-- รันซ้ำได้ (ลบของเดิมก่อน)

-- ลบของเดิม (ตั๋วก่อน แล้วค่อยวงเงิน)
delete from promissory_notes where pn_number in ('PN-RO-DEMO-000','PN-RO-DEMO-001','PN-RO-DEMO-002');
delete from credit_agreements where contract_number = 'CA-RO-DEMO-051';

-- 1) วงเงิน Revolving + เพดานต่อสัญญา 2 ครั้ง
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, rollover_max_times, rollover_max_days, finance_institution,
   start_date, end_date, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000051',
   'CA-RO-DEMO (Roll Over max 2)', 'CA-RO-DEMO-051', 'MCR',
   (select id from facility_types where code = 'PN' limit 1),
   50000000, 'THB', 'Revolving', 2, null, 'BBL',
   '2026-01-01', '2026-12-31', 'Approved');

-- 2) โซ่ตั๋ว 3 ใบ (ต่อสัญญามาแล้ว 2 ครั้ง)
-- ใบต้นฉบับ (ไม่มี parent) — ปิดเป็น Roll Over
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('bbbbbbbb-0000-0000-0000-000000000000',
   'PN-RO-DEMO-000', 'PN-RO-DEMO-000', 'aaaaaaaa-0000-0000-0000-000000000051',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-01-01', '2026-03-01', 59, 1000000, 'THB', 'Roll Over', null,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb);

-- ต่อสัญญาครั้งที่ 1 (parent = ใบต้นฉบับ) — ปิดเป็น Roll Over
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'PN-RO-DEMO-001', 'PN-RO-DEMO-001', 'aaaaaaaa-0000-0000-0000-000000000051',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-03-01', '2026-05-01', 61, 1010000, 'THB', 'Roll Over',
   'bbbbbbbb-0000-0000-0000-000000000000',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-03-01"}]'::jsonb);

-- ต่อสัญญาครั้งที่ 2 (parent = ครั้งที่ 1) — Active (ใช้ตัวนี้ทดสอบ)
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'PN-RO-DEMO-002', 'PN-RO-DEMO-002', 'aaaaaaaa-0000-0000-0000-000000000051',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-05-01', '2026-07-01', 61, 1020000, 'THB', 'Active',
   'bbbbbbbb-0000-0000-0000-000000000001',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb);
