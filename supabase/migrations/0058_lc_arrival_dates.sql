-- 0058_lc_arrival_dates.sql
-- Feature B10 — LC Arrival Date + Adjust Maturity
--
-- Workshop guidance (4.txt §325-345):
--   เปิด LC ใส่ Estimated Arrival → expiry_date = est_arrival + DOL (60 วัน)
--   เมื่อของถึงจริง → user กรอก Actual Arrival → กดปุ่ม Adjust Maturity
--   ระบบ recalc expiry_date = actual_arrival + deal_of_lending_days
--   Early Bid → user manual adjust expiry_date
--
-- Schema additions:
--   • estimated_arrival_date  — วันที่คาดว่าเรือเข้าท่า (ตอนเปิด LC)
--   • actual_arrival_date     — วันที่ของถึงจริง (กรอกเมื่อรับของแล้ว)
--   • deal_of_lending_days    — config default 60 days

ALTER TABLE letters_of_credit
  ADD COLUMN IF NOT EXISTS estimated_arrival_date DATE,
  ADD COLUMN IF NOT EXISTS actual_arrival_date    DATE,
  ADD COLUMN IF NOT EXISTS deal_of_lending_days   INTEGER NOT NULL DEFAULT 60;

COMMENT ON COLUMN letters_of_credit.estimated_arrival_date IS
  'B10 — วันที่คาดว่าเรือเข้าท่า · กรอกตอนเปิด LC · ใช้เป็นฐานคำนวณ expiry_date เริ่มต้น';
COMMENT ON COLUMN letters_of_credit.actual_arrival_date IS
  'B10 — วันที่ของถึงจริง · กรอกเมื่อรับของแล้ว · trigger Adjust Maturity → recalc expiry';
COMMENT ON COLUMN letters_of_credit.deal_of_lending_days IS
  'B10 — config DOL (default 60) · ใช้สูตร expiry = arrival + DOL';
