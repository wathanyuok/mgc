-- ============================================================
-- Seed: TR batch — TR-41 / TR-54 / TR-55 / TR-58 / TR-84 / TR-85
--   FIELD ครบ · รันซ้ำได้ · ใช้ MA/CA ชุดเดียวร่วมกัน
--
--   acct_cards มาตรฐาน T/R (ตรงกับที่โค้ดใช้ลงบัญชีจริง):
--     INVENTORY ACCOUNT        1151101 สินค้าคงเหลือ-ยานพาหนะ          (Dr วันเบิก)
--     NOTE PAYABLE ACCOUNT     2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน (Cr วันเบิก / Dr ตอนตัดชำระ)
--     INTEREST EXPENSE ACCOUNT 5512110 ดอกเบี้ยจ่าย-Short term loan     (Dr ตั้งดอกเบี้ยค้าง)
--     ACCRUED INTEREST ACCOUNT 2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน  (Cr ตั้งค้าง / Dr ตอนตัดชำระ)
--
--   TR ที่สร้าง:
--     TR-TR41A (Active · EUR) มีใบกำกับ INV-IMP-2024-0188 ผูกอยู่แล้ว
--     TR-TR41B (Active · EUR) ว่าง → ใช้ทดสอบว่าเลือกใบเดิมไม่ได้
--     TR-TR54  (Active · THB) พร้อมกดลงบัญชีวันเบิกเงิน (TR-54 + TR-55)
--     TR-TR58  (Active · THB) สำหรับไหลครบวงจร เบิก→ดอกเบี้ย→ตัดชำระ (TR-58)
--     *** ระบบ T/R ไม่มีสถานะ "Approved" แล้ว — ใช้ "Active" (ปุ่มอนุมัติตั้งให้เอง) ***
--     TR-TR84  (Closed · THB) สำหรับทดสอบเปิดกลับมาแก้
--     TR-TR85  (Repaid · THB) สำหรับทดสอบเงื่อนไขถูกล็อก
-- ============================================================

-- ---------- cleanup ----------
delete from journal_entries where source_type in ('TR_DRAWDOWN','TR_ACCRUED')
   and source_id in ('d9d9e270-0000-0000-0000-00000000a401','d9d9e270-0000-0000-0000-00000000a402',
                     'd9d9e270-0000-0000-0000-00000000a403','d9d9e270-0000-0000-0000-00000000a404',
                     'd9d9e270-0000-0000-0000-00000000a405','d9d9e270-0000-0000-0000-00000000a406');
delete from tr_imported_goods where tr_id in ('d9d9e270-0000-0000-0000-00000000a401','d9d9e270-0000-0000-0000-00000000a402',
                     'd9d9e270-0000-0000-0000-00000000a403','d9d9e270-0000-0000-0000-00000000a404',
                     'd9d9e270-0000-0000-0000-00000000a405','d9d9e270-0000-0000-0000-00000000a406');
delete from trust_receipts where tr_no in ('TR-TR41A','TR-TR41B','TR-TR54','TR-TR58','TR-TR84','TR-TR85');
delete from credit_agreements where id = 'd9d9e270-0000-0000-0000-0000000000d1' or contract_number = 'CA-TRX-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e270-0000-0000-0000-0000000000d2';
delete from master_agreements where id = 'd9d9e270-0000-0000-0000-0000000000d2' or ma_name = 'MA-TRX-DEMO';

-- ---------- ① MA + allocation ----------
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e270-0000-0000-0000-0000000000d2','BBL','MA-TRX-DEMO','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e270-0000-0000-0000-0000000000d2','MGC',50000000,0,0);

-- ---------- ② CA (facility T/R · Approved) ----------
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('d9d9e270-0000-0000-0000-0000000000d1','d9d9e270-0000-0000-0000-0000000000d2',
   'CA-TRX-DEMO (วงเงิน T/R 50 ล้าน)', 'CA-TRX-DEMO', 'MGC',
   (select id from facility_types where code='TR' limit 1),
   50000000, 'THB', 'Revolving', 'BBL',
   date '2026-01-01', date '2027-12-31', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb);

-- ---------- ③ Trust Receipts ----------
-- helper: acct_cards + rate_cards เหมือนกันทุกใบ (คัดลอกจาก CA)
insert into trust_receipts
  (id, tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date,
   due_date, transaction_date, maturity_date, term_days, amount, amount_foreign,
   conversion_date, conversion_rate, currency, reference_contract, rollover_parent_id,
   interest_rate_id, effective_rate, status, remark, rate_cards, acct_cards, created_at, updated_at)
values
  -- TR-41A : EUR · Active · ผูกใบกำกับ INV-IMP-2024-0188 แล้ว
  ('d9d9e270-0000-0000-0000-00000000a401','TR-TR41A','TR-TR41A (ผูกใบกำกับแล้ว)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','BMW AG (Munich)','INV-IMP-2024-0188', date '2026-03-15',
   date '2026-05-14', date '2026-03-15', date '2026-05-14', 60, 3500000, 89500,
   date '2026-03-15', 39.1061, 'EUR', null, null, null, 5, 'Active',
   'seed TR-41 · ใบนี้กินใบกำกับ INV-IMP-2024-0188 ไว้',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now()),

  -- TR-41B : EUR · Draft · ว่าง (ใช้ทดสอบเลือกใบเดิมไม่ได้)
  --   *** ต้องเป็น Draft เท่านั้น — ใบ Active/Approved ถูกล็อก read-only ปุ่มค้นหาสินค้านำเข้าจะถูกซ่อน ***
  --   ต้องเป็นสกุล EUR ให้ตรงกับ TR-41A จึงจะเห็นใบ INV-IMP-2024-0188 ใน lookup
  ('d9d9e270-0000-0000-0000-00000000a402','TR-TR41B','TR-TR41B (ไว้ลองเลือกใบเดิม)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','BMW AG (Munich)', null, null,
   date '2026-06-14', date '2026-04-15', date '2026-06-14', 60, 0, null,
   null, null, 'EUR', null, null, null, 5, 'Draft',
   'seed TR-41 · เปิดใบนี้แล้วกด Add Goods → ใบ INV-IMP-2024-0188 ต้องเลือกไม่ได้',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now()),

  -- TR-54 / TR-55 : THB · Active · พร้อมกด "ลงบัญชีวันเบิกเงิน"
  --   (ระบบไม่มีสถานะ Approved แล้ว — ปุ่มอนุมัติตั้งเป็น Active · Active ก็กดลงบัญชีวันเบิกได้)
  ('d9d9e270-0000-0000-0000-00000000a403','TR-TR54','TR-TR54 (ลงบัญชีวันเบิก/กลับรายการ)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','ผู้ขายในประเทศ จำกัด', 'INV-TR54-001', date '2026-07-01',
   date '2026-08-30', date '2026-07-01', date '2026-08-30', 60, 5000000, null,
   null, null, 'THB', null, null, null, 5, 'Active',
   'seed TR-54/55 · กดลงบัญชีวันเบิกเงิน → ปุ่มเปลี่ยนเป็น Reverse · กดซ้ำขึ้นว่ามีใบแล้ว',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now()),

  -- TR-58 : THB · Active · ไหลครบวงจร เบิก→ดอกเบี้ย→ตัดชำระ แล้วเช็คบัญชีถูกล้าง
  ('d9d9e270-0000-0000-0000-00000000a404','TR-TR58','TR-TR58 (ตัดชำระแล้วบัญชีต้องเป็นศูนย์)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','ผู้ขายในประเทศ จำกัด', 'INV-TR58-001', date '2026-07-01',
   date '2026-08-30', date '2026-07-01', date '2026-08-30', 60, 3000000, null,
   null, null, 'THB', null, null, null, 5, 'Active',
   'seed TR-58 · เบิก(Cr 2142101)→ดอกเบี้ย(Cr 2197109)→ตัดชำระต้อง Dr ล้างทั้งคู่จนเป็น 0',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now()),

  -- TR-84 : THB · Closed · ทดสอบเปิดกลับมาแก้
  ('d9d9e270-0000-0000-0000-00000000a405','TR-TR84','TR-TR84 (ปิดแล้ว · เปิดกลับมาแก้)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','ผู้ขายในประเทศ จำกัด', 'INV-TR84-001', date '2026-02-01',
   date '2026-04-01', date '2026-02-01', date '2026-04-01', 60, 2000000, null,
   null, null, 'THB', null, null, null, 5, 'Closed',
   'seed TR-84 · สถานะ Closed ไว้ทดสอบ revert เพื่อกลับมาแก้',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now()),

  -- TR-85 : THB · Repaid · ทดสอบเงื่อนไขถูกล็อก
  ('d9d9e270-0000-0000-0000-00000000a406','TR-TR85','TR-TR85 (ชำระครบ · เงื่อนไขล็อก)',
   'd9d9e270-0000-0000-0000-0000000000d1','BBL','ผู้ขายในประเทศ จำกัด', 'INV-TR85-001', date '2026-02-01',
   date '2026-04-01', date '2026-02-01', date '2026-04-01', 60, 2500000, null,
   null, null, 'THB', null, null, null, 5, 'Repaid',
   'seed TR-85 · สถานะ Repaid (frozen) ไว้ทดสอบว่าแก้เงื่อนไขไม่ได้',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-01-01"}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now());

-- ---------- ④ ใบกำกับที่ผูกกับ TR-41A แล้ว ----------
insert into tr_imported_goods (id, tr_id, reference_no, description, vendor, amount_foreign, sort_order)
values
  ('d9d9e270-0000-0000-0000-0000000000b1','d9d9e270-0000-0000-0000-00000000a401',
   'INV-IMP-2024-0188','Engine components X5','BMW AG (Munich)', 89500, 0);

-- ---------- ⑤ ตรวจผล seed ----------
select tr_no, status, currency, amount from trust_receipts
 where tr_no in ('TR-TR41A','TR-TR41B','TR-TR54','TR-TR58','TR-TR84','TR-TR85') order by tr_no;
select tr_id, reference_no from tr_imported_goods where tr_id = 'd9d9e270-0000-0000-0000-00000000a401';
