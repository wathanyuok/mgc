-- =====================================================================
-- Migration 0065 — Lease TFRS 16 Exemption support
-- =====================================================================
-- Adds `tfrs16_exemption` column to leases table.
-- Allowed values (nullable):
--   NULL         = normal TFRS 16 (recognize ROU + Lease Liability)
--   'short_term' = สัญญาเช่าระยะสั้น (≤ 12 เดือน) — skip ROU · book as rental expense
--   'low_value'  = สินทรัพย์มูลค่าต่ำ (Low-value asset) — skip ROU · book as rental expense
--
-- When exempt (not NULL): system MUST NOT create ROU/Liability JE at inception,
-- MUST NOT compute depreciation, and each period MUST post
--   Dr Rental Expense / Cr Cash (or AP)
--
-- Aligns with MGC's Excel "Low value and short-term" tracking sheet
-- (currently manual · this migration + UI lets MGC manage in-system).
--
-- Additive · idempotent · does not affect existing rows.
-- =====================================================================

ALTER TABLE leases ADD COLUMN IF NOT EXISTS tfrs16_exemption TEXT;

-- Enforce allowed values via CHECK constraint (idempotent guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'chk_leases_tfrs16_exemption'
  ) THEN
    ALTER TABLE leases ADD CONSTRAINT chk_leases_tfrs16_exemption
      CHECK (tfrs16_exemption IS NULL
             OR tfrs16_exemption IN ('short_term', 'low_value'));
  END IF;
END $$;

-- Partial index for reporting queries (Excel-style summary by exemption type)
CREATE INDEX IF NOT EXISTS idx_leases_tfrs16_exemption
  ON leases(tfrs16_exemption)
 WHERE tfrs16_exemption IS NOT NULL;

COMMENT ON COLUMN leases.tfrs16_exemption IS
  'TFRS 16 Exemption category. NULL = ปกติ (มี ROU + Liability) · short_term = ระยะสั้น ≤12 เดือน · low_value = สินทรัพย์มูลค่าต่ำ · ถ้าไม่ NULL ระบบจะ book เป็น Rental Expense แทน ROU/Liability';
