-- Migration 0112 — เพิ่มประเภท Bank / Non-Bank ให้สถาบันการเงิน (Bank Master)
--
-- เดิมหน้า report เดา Bank/Non-Bank จากลิสต์ชื่อ hardcode ในโค้ด (standard-reports.ts)
-- ⇒ เพิ่มสถาบันการเงินใหม่ (เช่น Sbank) แล้วจะขึ้นเป็น "Bank" เสมอ แก้ในหน้าจอไม่ได้
--
-- ย้ายมาเก็บเป็นฟิลด์จริงบน vendors — ผู้ดูแล/ dev ตั้งค่าตอนเพิ่มธนาคาร (SQL หรือ UI ในอนาคต)
-- report อ่านค่านี้แทนการเดา (fetchFiTypeMap) · fallback ลิสต์เดิมถ้ายังไม่ได้ตั้ง

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS fi_type text NOT NULL DEFAULT 'Bank'
  CHECK (fi_type IN ('Bank', 'Non-Bank'));

COMMENT ON COLUMN vendors.fi_type IS
  'ประเภทสถาบันการเงิน Bank / Non-Bank — ใช้จัดกลุ่มในรายงาน (เฉพาะ vendor_type = bank)';

-- ตั้งค่าเจ้าเดิมที่เป็น Non-Bank ให้ตรงกับลิสต์ hardcode เดิม (BMW-FS ฯลฯ)
UPDATE vendors
SET fi_type = 'Non-Bank'
WHERE vendor_type = 'bank'
  AND (
       upper(code) LIKE '%BMW-FS%'
    OR upper(code) LIKE '%BMW FINANCIAL%'
    OR upper(name) LIKE '%FINANCIAL SERVICES%'
    OR upper(name) LIKE '%LEASING%'
    OR upper(name) LIKE '%CAPITAL%'
  );
