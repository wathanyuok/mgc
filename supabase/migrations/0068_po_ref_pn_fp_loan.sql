-- =====================================================================
-- Migration 0068 — Add `po_ref` column to PN + FP + Loan
-- =====================================================================
-- Adds `po_ref` (NetSuite PO reference) to 3 tables that support Auto Drawdown:
--   promissory_notes · floor_plans · loans
--
-- Purpose:
--   - Store PO Ref from NetSuite when user imports drawdown from a PO
--   - Enable duplicate check (no 2 active records with same po_ref)
--   - Audit trail: link back to source PO in NetSuite
--
-- Rule: unique per Active record (partial index) — nullable
-- =====================================================================

BEGIN;

-- ── 1. Add column ────────────────────────────────────────
ALTER TABLE promissory_notes ADD COLUMN IF NOT EXISTS po_ref varchar(40);
ALTER TABLE floor_plans      ADD COLUMN IF NOT EXISTS po_ref varchar(40);
ALTER TABLE loans            ADD COLUMN IF NOT EXISTS po_ref varchar(40);

-- ── 2. Partial unique index — no duplicate active po_ref ─
CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_po_ref_active
  ON promissory_notes(po_ref)
 WHERE po_ref IS NOT NULL AND status IN ('Draft','Approved','Active');

CREATE UNIQUE INDEX IF NOT EXISTS uq_fp_po_ref_active
  ON floor_plans(po_ref)
 WHERE po_ref IS NOT NULL AND status IN ('Draft','Approved','Active');

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_po_ref_active
  ON loans(po_ref)
 WHERE po_ref IS NOT NULL AND status IN ('Draft','Approved','Active');

-- ── 3. Comments ──────────────────────────────────────────
COMMENT ON COLUMN promissory_notes.po_ref IS
  'PO Ref (NetSuite) — เลข PO จาก NetSuite (เช่น PO-2026-45678) · กรอกเพื่อดึงข้อมูล vendor/amount/delivery มาเติมในฟอร์มอัตโนมัติ · unique per active PN';
COMMENT ON COLUMN floor_plans.po_ref IS
  'PO Ref (NetSuite) — เลข PO จาก NetSuite · กรอกเพื่อดึง vendor/chassis list/amount/delivery จาก NetSuite · unique per active FP';
COMMENT ON COLUMN loans.po_ref IS
  'PO Ref (NetSuite) — เลข PO จาก NetSuite · กรอกเพื่อดึง vendor/amount/delivery จาก NetSuite · unique per active Loan';

COMMIT;

-- =====================================================================
-- Verify (run after apply):
-- =====================================================================
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('promissory_notes','floor_plans','loans')
--    AND column_name = 'po_ref';
-- =====================================================================
