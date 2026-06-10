-- =====================================================================
-- 0039_bank_line_facility_unique.sql
-- Purpose: Block duplicate facility link in bank_statement_lines
-- Reference: AC-7 of UC-LEASE-008 (Bank Statement Reconciliation)
-- Decision: Block (not overwrite) — confirmed with PM 2026-06
--
-- Note: Already applied to Production via SQL Editor 2026-06.
--       This file is for repo sync — uses IF NOT EXISTS to be idempotent.
-- =====================================================================

-- Ensure 1 Bank Line ↔ 1 (facility, period) pair
-- Partial index — only enforces when facility_type is set (allows nullable)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_line_facility
ON bank_statement_lines (facility_type, facility_id, source_period)
WHERE facility_type IS NOT NULL;

COMMENT ON INDEX uq_bank_line_facility IS
  'Prevent duplicate (facility_type, facility_id, source_period) — 1 Bank Line ↔ 1 งวด (AC-7 UC-LEASE-008)';
