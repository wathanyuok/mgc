-- =====================================================================
-- Migration 0062 — add bank_ref column to Loan, Floor Plan, Lease
-- =====================================================================
-- Closes coverage gap for SCB MCL matching:
-- 6 facility tables already have a bank ref field under different column
-- names (pn_number, lg_no, account_no, tr_no, fxf_no, lc_no).
-- Loan / Floor Plan / Lease had none. Adding here so we can search all 9
-- tables uniformly when parsing bank statement MCL patterns.
--
-- Value stored: the bank's contract reference for that facility, e.g.
-- SCB MCL 11-digit code that appears in bank statement descriptions like
-- 'MCL 02225332980 00031'.
--
-- Additive change — existing rows keep bank_ref = null.
-- =====================================================================

ALTER TABLE loans        ADD COLUMN IF NOT EXISTS bank_ref TEXT;
ALTER TABLE floor_plans  ADD COLUMN IF NOT EXISTS bank_ref TEXT;
ALTER TABLE leases       ADD COLUMN IF NOT EXISTS bank_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_loans_bank_ref       ON loans(bank_ref)       WHERE bank_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floor_plans_bank_ref ON floor_plans(bank_ref) WHERE bank_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leases_bank_ref      ON leases(bank_ref)      WHERE bank_ref IS NOT NULL;

COMMENT ON COLUMN loans.bank_ref       IS 'เลขอ้างอิงจากธนาคาร (SCB MCL หรือธนาคารอื่นให้) · ใช้ match Bank Statement auto';
COMMENT ON COLUMN floor_plans.bank_ref IS 'เลขอ้างอิงจากธนาคาร · ใช้ match Bank Statement auto';
COMMENT ON COLUMN leases.bank_ref      IS 'เลขอ้างอิงจากธนาคาร · ใช้ match Bank Statement auto';
