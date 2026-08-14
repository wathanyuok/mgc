-- 0084: Subsidiary Master ตามผังองค์กรจริง (คำแนะนำพี่ติ๋ง 14 ส.ค. 2026)
-- 1) upsert 16 บริษัทตามผัง  2) ปิด demo code ที่ไม่อยู่ในผัง
-- 3) แปลงข้อมูล MA/CA เดิมจากชื่อเต็ม → ชื่อย่อ (code)
-- Idempotent — รันซ้ำได้

-- 1. upsert ตามผังองค์กร (ชื่อเต็มใส่เฉพาะที่ยืนยันแล้ว · ที่เหลือใช้ code ไปก่อน รอลูกค้าเติม)
INSERT INTO subsidiaries (code, name, active) VALUES
  ('MGC', 'Millennium Group Corporation (Asia) Plc.', TRUE),
  ('i24', 'i24', TRUE),
  ('NEO', 'NEO', TRUE),
  ('ZMP', 'ZMP', TRUE),
  ('XMT', 'XMT', TRUE),
  ('XMP', 'XMP', TRUE),
  ('MGT', 'MGT', TRUE),
  ('MAG', 'Millennium Auto Group', TRUE),
  ('MCR', 'Millennium Cars', TRUE),
  ('MDS', 'MDS', TRUE),
  ('SHA', 'SHA', TRUE),
  ('MMS', 'MMS', TRUE),
  ('USM', 'USM', TRUE),
  ('GW',  'GW',  TRUE),
  ('AZM', 'AZM', TRUE),
  ('MAC', 'MAC', TRUE)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = TRUE, updated_at = NOW();

-- 2. ปิด code เก่า (seed demo 0050) ที่ไม่อยู่ในผัง
UPDATE subsidiaries SET active = FALSE, updated_at = NOW()
WHERE code NOT IN ('MGC','i24','NEO','ZMP','XMT','XMP','MGT','MAG','MCR','MDS','SHA','MMS','USM','GW','AZM','MAC');

-- 3. แปลงข้อมูลเดิม: MA/CA เก็บชื่อเต็ม/รูปแบบเก่า → code
UPDATE master_agreements SET subsidiary = 'MGC'
WHERE subsidiary IN ('Millennium Group Corporation (Asia) Plc.', 'MGC Asia Public Co., Ltd.');
UPDATE master_agreements SET subsidiary = 'MCR' WHERE subsidiary = 'Millennium Cars (MCR)';
UPDATE master_agreements SET subsidiary = 'MAG'
WHERE subsidiary IN ('Millennium Auto Group (MAG)', 'MGC Leasing Co., Ltd.');

UPDATE credit_agreements SET subsidiary = 'MGC'
WHERE subsidiary IN ('Millennium Group Corporation (Asia) Plc.', 'MGC Asia Public Co., Ltd.');
UPDATE credit_agreements SET subsidiary = 'MCR' WHERE subsidiary = 'Millennium Cars (MCR)';
UPDATE credit_agreements SET subsidiary = 'MAG'
WHERE subsidiary IN ('Millennium Auto Group (MAG)', 'MGC Leasing Co., Ltd.');
UPDATE credit_agreements SET subsidiary = 'i24' WHERE subsidiary = 'I-24';
