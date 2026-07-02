-- =====================================================================
-- Migration 0065 — TFRS 16 Exemption field on leases
-- =====================================================================
-- Support for IFRS 16 / TFRS 16 exemption cases:
--   short_term (สัญญาเช่าระยะสั้น ≤ 12 เดือน) — expense only, no ROU/Liability
--   low_value  (สินทรัพย์มูลค่าต่ำ)              — expense only, no ROU/Liability
--
-- When set, the system:
--   * Does NOT post Day 1 ROU + Liability JE
--   * Does NOT compute ROU depreciation
--   * Amortization Schedule → shown as flat Rental Expense per period
--   * Per-period JE = Dr Rental Expense / Cr Cash (or AP)
--
-- NULL = normal TFRS 16 (default behavior — Day 1 ROU/Liability + depreciation)
--
-- Matches MGC's Excel "Low value and short-term" tracking sheet
-- (True Internet Cloud contracts, D-Na photocopier contracts).
--
-- Additive & idempotent.
-- =====================================================================

ALTER TABLE leases ADD COLUMN IF NOT EXISTS tfrs16_exemption TEXT
  CHECK (tfrs16_exemption IS NULL
      OR tfrs16_exemption IN ('short_term', 'low_value'));

COMMENT ON COLUMN leases.tfrs16_exemption IS
  'TFRS 16 / IFRS 16 exemption category · NULL=normal (default, calc ROU/Liability) · short_term=ระยะสั้น ≤12 เดือน · low_value=สินทรัพย์มูลค่าต่ำ · Exempt cases skip ROU/Liability, JE=Dr Rental Expense / Cr Cash|AP';

CREATE INDEX IF NOT EXISTS idx_leases_tfrs16_exemption
  ON leases(tfrs16_exemption) WHERE tfrs16_exemption IS NOT NULL;
