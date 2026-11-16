-- =====================================================================
-- 0143 — เพิ่ม Vehicle Registration No (เลขทะเบียนรถ) ให้ HP/Lease
--   requirement: HP เพิ่ม field เลขทะเบียนรถ · แก้ไขภายหลังได้
--   nullable · optional · กรอกเอง หรือ auto-fill จาก FA Lookup (NetSuite FA มี vreg)
--   (รถสต๊อกใหม่ยังไม่จดทะเบียน → เว้นว่างได้ · กรอกทีหลังเมื่อรถจดทะเบียน)
-- =====================================================================
alter table leases add column if not exists vehicle_reg_no text;
