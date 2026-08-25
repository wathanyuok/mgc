-- 0093 — ย้ายข้อมูลเดิมเข้าชนิดใหม่ (ต่อจาก 0092)
--
-- สัญญาที่เดิมเป็น 'other' แต่ติ๊กว่าใช้สินเชื่อธนาคาร = Leasing ตัวจริง
-- ย้ายไปเป็น 'lease' · ที่เหลือคงเป็น 'other' (สัญญาเช่าที่ไม่ใช้สินเชื่อ)
--
-- รันซ้ำได้ เพราะรอบที่ 2 จะไม่เหลือแถวที่เข้าเงื่อนไข

UPDATE leases
   SET mode = 'lease'
 WHERE mode = 'other'
   AND use_bank_loan IS TRUE;

-- use_bank_loan กลายเป็นค่าที่คำนวณได้จาก mode แล้ว
-- ยังไม่ลบคอลัมน์ เพราะโค้ดเก่าบางจุดยังอ่านอยู่ · ปรับให้สอดคล้องกันไว้ก่อน
UPDATE leases SET use_bank_loan = (mode <> 'other');

-- Leasing Other ที่เคยผูก Credit Agreement ไว้ ให้ตัดออก เพราะชนิดนี้ไม่ใช้วงเงินธนาคาร
UPDATE leases SET ca_id = NULL WHERE mode = 'other' AND ca_id IS NOT NULL;

-- กันข้อมูลเพี้ยนภายหลัง — บังคับทั้ง 2 ทาง
--   hp / lease  ต้องผูก Credit Agreement
--   other       ต้องไม่ผูก
-- ใช้ NOT VALID เพื่อไม่ให้ล้มกับข้อมูลเดิมที่ยังกรอกไม่ครบ — บังคับเฉพาะแถวที่แก้หรือเพิ่มใหม่
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_ca_required_by_mode;
ALTER TABLE leases ADD CONSTRAINT leases_ca_required_by_mode
  CHECK (
    (mode = 'other' AND ca_id IS NULL)
    OR (mode <> 'other' AND ca_id IS NOT NULL)
  ) NOT VALID;
