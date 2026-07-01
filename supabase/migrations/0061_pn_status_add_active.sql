-- =====================================================================
-- Migration 0061 — add 'Active' value to pn_status enum
-- =====================================================================
-- Closes a long-standing gap: every other facility (Loan/OD/FP/TR/LG/LC/
-- Lease/FXF) uses 'Active' as the post-approval business status, but PN
-- was stuck with 'Approved' as its persistent active state — semantically
-- wrong (approval is a workflow gate, not a business status).
--
-- With the C2 Maker/Checker workflow now in place, we can align PN with
-- the rest: Draft → Submit → Approve → Active (approvedValue for
-- ApprovalPanel changes from 'Approved' to 'Active' in the same commit).
--
-- Additive change — existing rows with status='Approved' remain valid.
-- Idempotent: guarded by information_schema check.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'pn_status'
       AND e.enumlabel = 'Active'
  ) THEN
    ALTER TYPE pn_status ADD VALUE 'Active' AFTER 'Draft';
  END IF;
END $$;
