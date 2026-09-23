-- =====================================================================
-- Seed: MA-43 — ยอดใช้วงเงิน (UTILIZATION) ไหลขึ้นถึงสัญญาหลัก
-- =====================================================================
-- โครงสร้าง: Master Agreement → จัดสรรให้บริษัท A (MAG) → Credit Agreement
--            (ใต้ MA · บริษัท MAG) → Promissory Note 10 ล้าน (Active)
--
-- MA อ่าน UTILIZATION แบบ derived จาก credit_agreements.utilization
-- (group by subsidiary · where ma_id = MA) → seed จึงตั้ง CA.utilization = 10M
-- ให้ตรงกับ P/N 10M ที่เบิกไว้ · เปิดหน้า MA จะเห็นยอดไหลขึ้นทันที
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Master Agreement → MA-DEMO-ROLLUP
--   2) ตาราง Parent-Child (SUBSIDIARY) แถว MAG:
--        CREDIT LINE = 20,000,000 · UTILIZATION = 10,000,000 · REMAINING = 10,000,000
--        ยอดสรุปด้านบน UTILIZATION รวม = 10,000,000
--   3) (ทดสอบ flow เพิ่ม) เปิด CA-DEMO-ROLLUP → เปิด P/N ใหม่อีกใบ → กลับมา MA reload
--        → UTILIZATION เพิ่มตามโดยไม่ต้อง Save ที่ MA
--
-- รันซ้ำได้ (ลบลูกก่อนแม่)
-- =====================================================================

delete from promissory_notes  where pn_number   = 'PN-DEMO-ROLLUP';
delete from credit_agreements where contract_number = 'CA-DEMO-ROLLUP';
delete from ma_subsidiaries    where ma_id = 'a3a3a3a3-0000-0000-0000-000000000043';
delete from master_agreements  where id    = 'a3a3a3a3-0000-0000-0000-000000000043';

-- ① สัญญาหลัก (MA) — วงเงินรวม 50M
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status,
   start_date, end_date, credit_line, utilization)
values
  ('a3a3a3a3-0000-0000-0000-000000000043', 'BBL', 'MA-DEMO-ROLLUP', 'MGC', 'Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);

-- ② จัดสรรวงเงินให้บริษัท A (MAG) 20M — แถวในตาราง Parent-Child (SUBSIDIARY)
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values
  ('a3a3a3a3-0000-0000-0000-000000000043', 'MAG', 20000000, 0, 0);

-- ③ วงเงินย่อย (CA) ใต้ MA · บริษัท MAG · เบิกใช้ไปแล้ว 10M (= P/N ด้านล่าง)
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id,
   credit_line, utilization, currency, credit_type, finance_institution,
   start_date, end_date, status)
values
  ('a3a3a3a3-0000-0000-0000-0000000000ca', 'CA เดโม — บริษัท MAG', 'CA-DEMO-ROLLUP',
   'a3a3a3a3-0000-0000-0000-000000000043', 'MAG',
   (select id from facility_types where code = 'PN' limit 1),
   20000000, 10000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved');

-- ④ ตั๋วสัญญาใช้เงิน (P/N) 10M · Active · ผูกกับ CA ข้างบน
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution,
   transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('a3a3a3a3-0000-0000-0000-0000000000a1', 'PN เดโม 10M — MAG', 'PN-DEMO-ROLLUP',
   'a3a3a3a3-0000-0000-0000-0000000000ca',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-09-01', '2026-12-01', 91, 10000000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb);
