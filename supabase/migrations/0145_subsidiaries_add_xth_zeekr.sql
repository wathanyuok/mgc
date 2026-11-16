-- 0145: เพิ่มบริษัทในเครือ XTH เข้า Subsidiary Master (ต่อจากผัง 0084)
-- ชื่อเต็มยังไม่ยืนยัน → ใช้ code เป็น name ไปก่อน (รอลูกค้าเติม เหมือน 0084)
-- NEO มีอยู่แล้วจาก 0084 — ย้ำ active ไว้กันกรณีถูกปิด
-- หลังรัน: โผล่อัตโนมัติในหน้า User (บริษัทที่ดูแล) + dropdown MA/CA (active=true, order by code)
-- Idempotent — รันซ้ำได้
INSERT INTO subsidiaries (code, name, active) VALUES
  ('XTH', 'XTH', TRUE),
  ('NEO', 'NEO', TRUE)
ON CONFLICT (code) DO UPDATE SET active = TRUE, updated_at = NOW();
