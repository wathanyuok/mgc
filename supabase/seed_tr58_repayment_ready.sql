-- ============================================================
-- Seed: TR-58 — ใบตัดชำระสำเร็จรูป (Repayment) สำหรับ TR-TR58
--   เปิดเมนู Repayment → เปิดใบนี้ (RP-TR58-DEMO) → กด "ลงบัญชี" ได้เลย ไม่ต้องกรอก
--
--   *** ต้องรัน seed_tr_batch_uc_demo.sql ก่อน (ใช้ TR-TR58 id = a404) ***
--
--   ลำดับที่ถูกต้องก่อนกดลงบัญชีใบตัดชำระ:
--     1) TR-TR58 → ลงบัญชีวันเบิกเงิน   (Cr 2142101 = 3,000,000)
--     2) TR-TR58 → Post Period JE ทุกงวด (Cr 2197109 รวม = 24,657.54 · 2 งวด×12,328.77)
--        *** ต้องโพสต์ดอกเบี้ยก่อน ระบบจึงรู้ว่า "เคยตั้งค้างจ่าย" แล้ว Dr ล้าง 2197109 ***
--     3) เปิดใบ RP-TR58-DEMO นี้ → กด "ลงบัญชี"
--        ใบ REPAYMENT: Dr 2142101 3,000,000 + Dr 2197109 24,657.54 / Cr ช่องทางจ่าย
--
--   ยอดในใบ (ตรงกับที่ระบบ accrue พอดี เพื่อให้ล้างเป็นศูนย์):
--     Principal 3,000,000.00 · Interest 24,657.54 · รวม 3,024,657.54
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from repayment_lines where repayment_id = 'd9d9e270-0000-0000-0000-0000000000b8';
delete from repayments      where id = 'd9d9e270-0000-0000-0000-0000000000b8' or repayment_no = 'RP-TR58-DEMO';

-- ① Repayment header (Draft — ยังไม่ลงบัญชี รอผู้ใช้กดเอง)
--   หมายเหตุ: migration 0076 เปลี่ยน repayments.facility_type (text) → facility_type_id (UUID FK)
insert into repayments
  (id, repayment_no, facility_type_id, facility_id, pay_date, amount, principal, interest,
   fee, vat, wht, penalty, channel, payment_type, reference_no, remark, status, created_at, updated_at)
values
  ('d9d9e270-0000-0000-0000-0000000000b8','RP-TR58-DEMO',
   (select id from facility_types where code='TR' limit 1),'d9d9e270-0000-0000-0000-00000000a404',
   date '2026-08-30', 3024657.54, 3000000, 24657.54,
   0, 0, 0, 0, 'Bank Statement', null, 'INV-TR58-001',
   'seed TR-58 · ตัดชำระเต็ม (ต้น 3,000,000 + ดอกเบี้ย 24,657.54) → กดลงบัญชีเองได้เลย',
   'Draft', now(), now());

-- ② Repayment lines — แยกประเภท เงินต้น / ดอกเบี้ย
--   repayment_lines ยังมีทั้ง facility_type (text) และ facility_type_id (UUID) — ใส่ทั้งคู่ให้ครบ
insert into repayment_lines
  (id, repayment_id, facility_type, facility_type_id, facility_id, contract_label, category, amount, sort_order)
values
  ('d9d9e270-0000-0000-0000-0000000000b9','d9d9e270-0000-0000-0000-0000000000b8','TR',
   (select id from facility_types where code='TR' limit 1),
   'd9d9e270-0000-0000-0000-00000000a404','TR-TR58','Principal', 3000000, 0),
  ('d9d9e270-0000-0000-0000-0000000000ba','d9d9e270-0000-0000-0000-0000000000b8','TR',
   (select id from facility_types where code='TR' limit 1),
   'd9d9e270-0000-0000-0000-00000000a404','TR-TR58','Interest', 24657.54, 1);

-- ③ ตรวจผล
select r.repayment_no, r.status, r.principal, r.interest, r.amount,
       (select count(*) from repayment_lines l where l.repayment_id = r.id) as line_count
  from repayments r where r.id = 'd9d9e270-0000-0000-0000-0000000000b8';
-- คาดหวัง: RP-TR58-DEMO · Draft · 3,000,000 · 24,657.54 · 3,024,657.54 · 2 บรรทัด
