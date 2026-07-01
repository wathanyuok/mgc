-- 0059_facility_adjustments.sql
-- Feature C3 — T+2 Reconcile + Manual Adjust workflow (polymorphic across Loan-side facilities)
--
-- Workshop guidance (3.txt §3-75):
--   "ตัว Loan กับ Leasing ไอ้ตัว Hyperchase นี่แยกออกจากกัน · Leasing ตัดตาม Payment Schedule ·
--    Loan ก็คือรอ การตัด แล้วค่อยเอามาตัดยอด"
--   → apply to ALL Loan-side facilities that accrue interest and need to
--     reconcile against Bank Statement (T+2): Loan, PN, FP, OD, TR.
--     Lease + HP are excluded (schedule-driven).
--
--   บัญชี "manual adjust" — เอายอดจาก Bank Statement เป็น total, split ใหม่
--   ระหว่าง principal/interest, พร้อม reason (rate_change · day_diff ·
--   bank_overcut · other) และ optionally flag ว่าธนาคารตัดเกิน.
--
--   JE reallocation:
--     Δ = adjusted_principal − original_principal
--     Δ > 0  → Dr Interest Income / Cr Loan Principal Receivable (Δ)
--     Δ < 0  → กลับด้าน (โอน Principal → Interest)

CREATE TABLE IF NOT EXISTS facility_adjustments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic facility reference (app-side validated; no DB FK because it varies per module)
  facility_type               VARCHAR(20) NOT NULL,               -- 'Loan' | 'PN' | 'FP' | 'OD' | 'TR'
  facility_id                 UUID NOT NULL,
  period                      INTEGER NOT NULL,                    -- schedule period_no
  bank_statement_line_id      UUID,                                -- optional link
  -- Original (from source schedule snapshot)
  original_principal          NUMERIC(18,2) NOT NULL,
  original_interest           NUMERIC(18,2) NOT NULL,
  original_total              NUMERIC(18,2) NOT NULL,
  -- Adjusted values (user input)
  adjusted_principal          NUMERIC(18,2) NOT NULL,
  adjusted_interest           NUMERIC(18,2) NOT NULL,
  adjusted_total              NUMERIC(18,2) NOT NULL,
  -- Optional bank over-cut flag → tracks refund owed by bank
  refund_pending              BOOLEAN NOT NULL DEFAULT FALSE,
  refund_amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
  refund_received_date        DATE,
  -- Reason for the adjustment
  reason                      VARCHAR(20) NOT NULL DEFAULT 'other',
  notes                       TEXT,
  je_id                       UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  status                      VARCHAR(20) NOT NULL DEFAULT 'Posted',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_facility_adjustments_facility
  ON facility_adjustments(facility_type, facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_adjustments_period
  ON facility_adjustments(facility_type, facility_id, period);
CREATE INDEX IF NOT EXISTS idx_facility_adjustments_bank_line
  ON facility_adjustments(bank_statement_line_id);
CREATE INDEX IF NOT EXISTS idx_facility_adjustments_refund
  ON facility_adjustments(refund_pending) WHERE refund_pending = TRUE;

-- RLS
ALTER TABLE facility_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_facility_adjustments" ON facility_adjustments;
CREATE POLICY "anon_all_facility_adjustments" ON facility_adjustments
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE facility_adjustments IS
  'C3 — Manual reconciliation adjustments per (facility_type, facility_id, period). Polymorphic across Loan/PN/FP/OD/TR (Loan-side facilities that reconcile against Bank Statement). One row per adjustment action.';
COMMENT ON COLUMN facility_adjustments.facility_type IS
  'Loan | PN | FP | OD | TR (Lease/HP excluded — schedule-driven)';
COMMENT ON COLUMN facility_adjustments.reason IS
  'rate_change | day_diff | bank_overcut | other';
COMMENT ON COLUMN facility_adjustments.refund_pending IS
  'TRUE when bank over-cut — tracks refund owed. Cleared when refund_received_date is filled.';
COMMENT ON COLUMN facility_adjustments.je_id IS
  'Reallocation JE (source_type=FACILITY_ADJUST). Δ > 0 = shift Interest → Principal, Δ < 0 = reverse.';
