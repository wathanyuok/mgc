-- Seed: PN demo สำหรับทดสอบ PN-52 (ต่อสัญญาแล้วอายุรวมเกินเพดานจำนวนวัน)
--
-- สร้าง:
--   1) วงเงิน (CA) Revolving · ROLL OVER CONDITION MAXIMUM TERM (DAYS) = 180
--      (ไม่ตั้ง MAXIMUM ROLL OVER TIMES → กฎ "จำนวนครั้ง" ไม่ทำงาน เหลือแต่กฎ "จำนวนวัน")
--   2) โซ่ตั๋ว 2 ใบ: PN-RO-DAYS-000 (ต้นฉบับ, tx 01/01/2026) → PN-RO-DAYS-001 (Active)
--      อายุรวมนับจากวันเริ่มตั๋วต้นฉบับ = 01/01/2026
--
-- เพดาน 180 วัน → 01/01/2026 + 180 วัน = 30/06/2026
--   - ใส่ Maturity ใหม่ >= 01/07/2026  → เกินเพดาน (error สีแดง)
--   - ใส่ Maturity ใหม่ 13/06–30/06/2026 → ใกล้เพดาน >90% (เตือนสีเหลือง แต่ทำต่อได้)
--   - ใส่ Maturity ใหม่ <= 12/06/2026  → ปกติ ไม่ขึ้นอะไร
--
-- ทดสอบ: เปิด PN-RO-DAYS-001 → กดปุ่ม "Roll Over" (มุมขวาบน)
--   ช่อง "Maturity Date ใหม่" ใส่ 01/08/2026 → กล่องแดง
--   "ทำรายการไม่ได้ — อายุรวม N วัน เกินจำกัด 180 วัน (จาก CA)" · ปุ่ม Confirm Roll Over กดไม่ได้
--   (ลองใส่ 20/06/2026 จะได้กล่องเหลือง "อายุรวม N วัน ใกล้เพดาน 180 วัน" แต่ยังกดยืนยันได้)
--
-- หมายเหตุ: ปุ่ม Roll Over ต้อง login เป็นผู้มีสิทธิ์ approve P/N (สิทธิ์ผู้ใช้ seed ไม่ได้)
-- รันซ้ำได้ (ลบของเดิมก่อน)

delete from promissory_notes where pn_number in ('PN-RO-DAYS-000','PN-RO-DAYS-001');
delete from credit_agreements where contract_number = 'CA-RO-DAYS-052';

-- 1) วงเงิน Revolving + เพดานอายุรวม 180 วัน (ไม่ตั้งจำนวนครั้ง)
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, rollover_max_times, rollover_max_days, finance_institution,
   start_date, end_date, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000052',
   'CA-RO-DAYS-DEMO (Roll Over max 180 days)', 'CA-RO-DAYS-052', 'MCR',
   (select id from facility_types where code = 'PN' limit 1),
   50000000, 'THB', 'Revolving', null, 180, 'BBL',
   '2026-01-01', '2026-12-31', 'Approved');

-- 2) โซ่ตั๋ว 2 ใบ
-- ใบต้นฉบับ (tx 01/01/2026 = วันตั้งต้นของอายุรวม) — ปิดเป็น Roll Over
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('cccccccc-0000-0000-0000-000000000000',
   'PN-RO-DAYS-000', 'PN-RO-DAYS-000', 'aaaaaaaa-0000-0000-0000-000000000052',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-01-01', '2026-03-15', 73, 1000000, 'THB', 'Roll Over', null,
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb);

-- ต่อสัญญาครั้งที่ 1 (parent = ใบต้นฉบับ) — Active (ใช้ตัวนี้ทดสอบ)
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rollover_parent_id, rate_cards)
values
  ('cccccccc-0000-0000-0000-000000000001',
   'PN-RO-DAYS-001', 'PN-RO-DAYS-001', 'aaaaaaaa-0000-0000-0000-000000000052',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-03-15', '2026-05-15', 61, 1010000, 'THB', 'Active',
   'cccccccc-0000-0000-0000-000000000000',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-03-15"}]'::jsonb);
