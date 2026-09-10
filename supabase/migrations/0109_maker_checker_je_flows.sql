-- Migration 0109 — Maker→Approver flow ให้การกระทำที่ลง JE คนเดียว
-- (Lease Modified · LC Converted · FXF Settled) — Maker ขอ → Approver อนุมัติก่อนลง JE
--
-- เพิ่มสถานะ "รอ..." + คอลัมน์เก็บคำขอ (ผู้ขอ + เวลา + พารามิเตอร์)
-- หมายเหตุ: ALTER TYPE ADD VALUE รันเป็น statement แยก

-- ── FXF Settled ────────────────────────────────────────────────
ALTER TYPE fxf_status ADD VALUE IF NOT EXISTS 'Pending Settlement';
ALTER TABLE fx_forwards
  ADD COLUMN IF NOT EXISTS settlement_requested_by text,
  ADD COLUMN IF NOT EXISTS settlement_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_rate         numeric(18,6);

-- ── LC Converted ──────────────────────────────────────────────
ALTER TYPE lc_status ADD VALUE IF NOT EXISTS 'Pending Conversion';
ALTER TABLE letters_of_credit
  ADD COLUMN IF NOT EXISTS conversion_requested_by text,
  ADD COLUMN IF NOT EXISTS conversion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_req_date     date,
  ADD COLUMN IF NOT EXISTS conversion_req_term_days int;

-- ── Lease Modified (re-measurement) ───────────────────────────
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'Pending Modification';
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS remeasure_requested_by text,
  ADD COLUMN IF NOT EXISTS remeasure_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS remeasure_params       jsonb;
