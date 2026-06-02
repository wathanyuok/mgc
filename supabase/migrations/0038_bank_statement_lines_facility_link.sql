-- 0038_bank_statement_lines_facility_link.sql
-- Add columns to link Bank Statement Lines to facility payments (HP/Lease/Loan/PN/FP/TR/LC/FXF).
-- Per MoM Day 4 §8.1: HP + Bank-Credit Lease ใช้ Bank Statement direct cut (reconcile by matching).
-- Lvl 1 Lite: manual link only — no JE flow change yet.

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS facility_type TEXT
    CHECK (facility_type IN ('P/N','LG','LC','FP','OD','TR','FXF','Loan','HP','Lease')),
  ADD COLUMN IF NOT EXISTS facility_id UUID,
  ADD COLUMN IF NOT EXISTS source_period INTEGER;

-- Index for fast lookup from facility side (e.g. Lease detail asks "which BS lines link to me?")
CREATE INDEX IF NOT EXISTS idx_bank_stmt_lines_facility
  ON bank_statement_lines(facility_type, facility_id, source_period);

COMMENT ON COLUMN bank_statement_lines.facility_type IS
  'Linked facility type (P/N, LG, LC, FP, OD, TR, FXF, Loan, HP, Lease). Null = not yet matched.';
COMMENT ON COLUMN bank_statement_lines.facility_id IS
  'UUID of the linked facility row. Null = not yet matched.';
COMMENT ON COLUMN bank_statement_lines.source_period IS
  'Installment number (1-based) for installment-based facilities (Loan/HP/Lease/PN). Null for one-time settlements (TR/LC/FXF/LG).';
