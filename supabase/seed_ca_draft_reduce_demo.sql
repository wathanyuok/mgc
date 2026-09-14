-- Seed: demo ทดสอบเคส CA อนุมัติแล้ว + มีธุรกรรมเบิกเต็มวงเงิน แล้วขอแก้ไข/ลดวงเงิน
--
-- สร้าง:
--   1) CA-DRAFT-DEMO · วงเงิน 100,000 · status Approved · utilization 100,000 (เบิกเต็ม)
--   2) P/N ใต้ CA นี้ · amount 100,000 · Active (เป็นตัวที่เบิกใช้วงเงิน)
--
-- ทดสอบ:
--   A) เปิด CA-DRAFT-DEMO → กด "ขอให้แก้ไข" (request changes)
--      ผล: กดได้เลย ไม่มีบล็อก/เตือน · CA → Draft · P/N ยัง Active เบิก 100,000 อยู่ (ไม่กระทบ)
--   B) ตอน CA เป็น Draft → ลองแก้ CREDIT LINE เหลือ 90,000 → กด Save
--      ผล: บล็อก · error "ลดวงเงินไม่ได้ — วงเงินใหม่ (90,000) ต่ำกว่ายอดที่เบิกใช้ไปแล้ว (100,000) ..."
--   C) แก้ CREDIT LINE เหลือ 100,000 (= ยอดเบิกพอดี) → Save ได้
--   D) ลองสร้าง P/N ใหม่ → ช่องเลือก CA จะไม่เห็น CA-DRAFT-DEMO (เพราะยัง Draft · เลือกได้แต่ Approved)
--
-- รันซ้ำได้ (ลบของเดิมก่อน)

delete from promissory_notes where pn_number = 'PN-CADRAFT-DEMO';
delete from credit_agreements where contract_number = 'CA-DRAFT-DEMO';

-- 1) CA วงเงิน 100,000 · Approved · เบิกเต็ม (utilization 100,000)
insert into credit_agreements
  (id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, utilization, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('55555555-0000-0000-0000-0000000000ca',
   'CA-DRAFT-DEMO (วงเงิน 100k เบิกเต็ม)', 'CA-DRAFT-DEMO', 'MCR',
   (select id from facility_types where code = 'PN' limit 1),
   100000, 100000, 'THB', 'Revolving', 'BBL',
   current_date - 30, current_date + 335, 'Approved');

-- 2) P/N เบิกเต็มวงเงิน 100,000 · Active
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution,
   transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('55555555-0000-0000-0000-0000000000a1',
   'PN-CADRAFT-DEMO', 'PN-CADRAFT-DEMO',
   '55555555-0000-0000-0000-0000000000ca',
   (select id from facility_types where code = 'PN' limit 1), 'BBL',
   current_date - 20, current_date + 70, 90, 100000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb);

-- 3) กันเหนียว: sync utilization ให้ตรงกับยอด P/N (เผื่อ trigger ไม่ยิงตอน seed)
update credit_agreements
   set utilization = 100000
 where id = '55555555-0000-0000-0000-0000000000ca';
