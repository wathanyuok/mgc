-- Migration 0107 — LG/BG Early Termination approval flow (Maker ขอ → Approver อนุมัติ)
--
-- เพิ่ม:
--   1) สถานะ 'Pending Termination' ใน enum lg_status (คำขอยกเลิกที่รออนุมัติ)
--   2) คอลัมน์เก็บพารามิเตอร์คำขอยกเลิก บน letter_guarantees
--      เพื่อให้ผู้อนุมัติเห็นยอดเงินคืน + คำนวณตรงกับที่ Maker ขอ ตอนกดอนุมัติ
--
-- หมายเหตุ: ALTER TYPE ... ADD VALUE รันเป็น statement แยก (ห้ามใช้ค่าใหม่ในไฟล์เดียวกัน)
-- ถ้า SQL Editor รันทั้งไฟล์แล้วติด transaction block ให้รันบรรทัด ADD VALUE ก่อน แล้วค่อยรันส่วน ALTER TABLE

ALTER TYPE lg_status ADD VALUE IF NOT EXISTS 'Pending Termination';

ALTER TABLE letter_guarantees
  ADD COLUMN IF NOT EXISTS termination_requested_by      text,
  ADD COLUMN IF NOT EXISTS termination_requested_at      timestamptz,
  ADD COLUMN IF NOT EXISTS termination_notification_date date,
  ADD COLUMN IF NOT EXISTS termination_lead_time_days    int,
  ADD COLUMN IF NOT EXISTS termination_refund_schedule   text;

COMMENT ON COLUMN letter_guarantees.termination_requested_by IS
  'ผู้ยื่นคำขอยกเลิกก่อนกำหนด (Maker) — ใช้กันไม่ให้อนุมัติคำขอตัวเอง (ยกเว้น Admin)';
