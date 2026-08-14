-- 0086: เพิ่มผู้จำหน่ายรถ (dealer) ที่หน้าจอ FP/Curtailment ใช้อยู่ เข้า Vendor Master
-- ให้ FP + Curtailment ดึงรายชื่อจากแหล่งเดียวกัน — ชื่อตรงกับข้อมูลเดิมในระบบ ไม่ต้องแปลงข้อมูล
-- รายชื่อจริงจาก NetSuite มาเมื่อไหร่ ค่อย update/ปิด active รายตัว · Idempotent

INSERT INTO vendors (code, name, vendor_type, active) VALUES
  ('DEALER-BMW-TH',  'BMW (Thailand) Co., Ltd.',        'dealer', TRUE),
  ('DEALER-HONDA',   'Honda Automobile Co., Ltd.',      'dealer', TRUE),
  ('DEALER-TOYOTA',  'Toyota Motor Thailand Co., Ltd.', 'dealer', TRUE),
  ('DEALER-MB',      'Mercedes-Benz (Thailand)',        'dealer', TRUE),
  ('DEALER-NISSAN',  'Nissan Motor (Thailand)',         'dealer', TRUE),
  ('DEALER-BYD',     'BYD Auto (Thailand) Co., Ltd.',   'dealer', TRUE)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = TRUE;
