-- Migration 0111 — MA / CA Termination approval flow (dropdown-only, Maker ขอ → Approver อนุมัติ)
--
-- ทำให้การ "ปิดสัญญา" ของสัญญาหลัก (MA) และวงเงิน (CA) เป็น maker-checker เหมือนธุรกรรม
-- ต่างจาก LG ตรงที่ MA/CA ทำผ่าน dropdown ล้วน (ไม่มีปุ่ม) และไม่มี JE
--
-- เพิ่ม:
--   1) สถานะ 'Pending Termination' ใน enum ma_status / ca_status (คำขอปิดที่รออนุมัติ)
--   2) คอลัมน์ audit ผู้ยื่นคำขอปิด — ใช้กันไม่ให้คนขอมาอนุมัติคำขอตัวเอง (ยกเว้น Admin)
--
-- flow (เลือกใน dropdown แล้ว Save):
--   Approved → Pending Termination   = ขอปิด (Maker) · set termination_requested_by
--   Pending Termination → Terminated = อนุมัติปิด (Approver ที่ไม่ใช่คนขอ)
--   Pending Termination → Approved   = ส่งกลับ · ล้าง termination_requested_by
--
-- หมายเหตุ: ALTER TYPE ... ADD VALUE รันเป็น statement แยก และห้ามใช้ค่าใหม่ในทรานแซกชันเดียวกัน
-- ถ้า SQL Editor ติด transaction block ให้รัน 2 บรรทัด ADD VALUE ก่อน แล้วค่อยรันส่วน ALTER TABLE

ALTER TYPE ma_status ADD VALUE IF NOT EXISTS 'Pending Termination';
ALTER TYPE ca_status ADD VALUE IF NOT EXISTS 'Pending Termination';

ALTER TABLE master_agreements
  ADD COLUMN IF NOT EXISTS termination_requested_by text,
  ADD COLUMN IF NOT EXISTS termination_requested_at timestamptz;

ALTER TABLE credit_agreements
  ADD COLUMN IF NOT EXISTS termination_requested_by text,
  ADD COLUMN IF NOT EXISTS termination_requested_at timestamptz;

COMMENT ON COLUMN master_agreements.termination_requested_by IS
  'ผู้ยื่นคำขอปิดสัญญา (Maker) — ใช้กันไม่ให้อนุมัติคำขอตัวเอง (ยกเว้น Admin)';
COMMENT ON COLUMN credit_agreements.termination_requested_by IS
  'ผู้ยื่นคำขอปิดวงเงิน (Maker) — ใช้กันไม่ให้อนุมัติคำขอตัวเอง (ยกเว้น Admin)';
