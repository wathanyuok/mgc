-- Migration 0110 — เพิ่มสถานะ 'Cancelled' ให้ MA / CA
-- เพื่อรองรับ "Maker ยกเลิกฉบับร่างเอง" (self-cancel) ให้ครบทุกโมดูลตาม Status Map
-- (MA/CA มี 'Rejected' อยู่แล้วสำหรับการปฏิเสธของผู้อนุมัติ · Cancelled = ผู้จัดทำยกเลิกเอง)

ALTER TYPE ma_status ADD VALUE IF NOT EXISTS 'Cancelled';
ALTER TYPE ca_status ADD VALUE IF NOT EXISTS 'Cancelled';
