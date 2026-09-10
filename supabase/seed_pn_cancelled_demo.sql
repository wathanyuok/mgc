-- Seed: PN demo สำหรับทดสอบ PN-60 (สถานะที่เปิดแก้ไขไม่ได้ = Cancelled / terminal)
--
-- สร้าง: ตั๋ว PN-DEMO-CANCELLED-060 สถานะ Cancelled
--
-- ทดสอบ: เปิด PN-DEMO-CANCELLED-060
--   - เห็นแถบสีเทา "🔒 P/N นี้สถานะ Cancelled แล้ว — read-only (revert Status เพื่อแก้)"
--   - ทุกช่องแก้ไม่ได้ · ปุ่มลงบัญชี (Post JE) กดไม่ได้
--   - กด Save → "P/N สถานะ Cancelled — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)"
--
-- รันซ้ำได้ (ลบของเดิมก่อน)

delete from promissory_notes where pn_number = 'PN-DEMO-CANCELLED-060';

insert into promissory_notes
  (id, name, pn_number, facility_type_id, finance_institution, transaction_date, maturity_date,
   term_days, amount, currency, status, rate_cards)
values
  ('ffffffff-0000-0000-0000-000000000060',
   'PN-DEMO-CANCELLED-060', 'PN-DEMO-CANCELLED-060',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   '2026-01-01', '2026-04-01', 90, 1000000, 'THB', 'Cancelled',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb);
