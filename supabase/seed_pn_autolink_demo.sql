-- Seed: demo ทดสอบ "หา link อัตโนมัติ" (auto-link) ของ Bank Statement → P/N
--
-- สร้าง P/N ที่ pn_number = '10120970001' (เลขอ้างอิง 11 หลักแบบ MCL)
-- แล้วใช้คู่กับไฟล์ทดสอบ  seed_autolink_scb_MCL.csv  ที่มีบรรทัด
--   Description = "MCL 10120970001 00001 ..."  (ชำระงวดที่ 1)
--
-- ทดสอบ:
--   1) รัน seed นี้ (สร้าง P/N)
--   2) เมนู Bank Statement → Import ไฟล์ → เลือก seed_autolink_scb_MCL.csv
--   3) กด Save (หรือกดปุ่ม "หา link อัตโนมัติ" ในหน้า Detail)
--   ผล: บรรทัดที่มี "MCL 10120970001 00001" จะถูกผูกกับ P/N นี้ + งวด 1 อัตโนมัติ
--       (LINKED FACILITY = P/N · PN-AUTOLINK-DEMO) · ส่วนบรรทัดอื่นที่ไม่มี MCL = ไม่ผูก
--
-- รันซ้ำได้ (ลบของเดิมก่อน)

delete from promissory_notes where pn_number = '10120970001';

insert into promissory_notes
  (id, name, pn_number, facility_type_id, finance_institution,
   transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('aaaaaaaa-0000-0000-0000-0000000a1140',
   'PN-AUTOLINK-DEMO', '10120970001',
   (select id from facility_types where code = 'PN' limit 1), 'SCB',
   '2026-05-01', '2026-07-30', 90, 5000000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-05-01"}]'::jsonb);
