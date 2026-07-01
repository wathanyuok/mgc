-- 0060_approval_workflow.sql
-- Feature C2 — Maker/Checker/Approver workflow
--
-- Adds approval tracking columns to Loan-side facility tables so the
-- system can enforce a two-step handoff:
--   Draft  →  submitted (Ready for Approval)  →  Approved/Active
--
-- The columns are nullable and additive — existing rows continue to work
-- unchanged. Application code decides which buttons to show based on
-- (submitted_at IS NULL) vs (approved_at IS NULL).
--
-- Applied to: loans, promissory_notes, floor_plans, overdrafts,
-- trust_receipts, letter_guarantees, letters_of_credit, leases, fx_forwards.
-- (Lease is included for HP-side too; skip if not needed.)

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'loans', 'promissory_notes', 'floor_plans', 'overdrafts',
      'trust_receipts', 'letter_guarantees', 'letters_of_credit',
      'leases', 'fx_forwards'
    ])
  LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS submitted_by     TEXT,
        ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS approved_by      TEXT,
        ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    $sql$, t);
  END LOOP;
END $$;

-- Comments on the shared columns
COMMENT ON COLUMN loans.submitted_by IS
  'C2 — Maker sends for review · set when user clicks "Submit for Approval". NULL = still Draft';
COMMENT ON COLUMN loans.submitted_at IS
  'C2 — timestamp of submission';
COMMENT ON COLUMN loans.approved_by IS
  'C2 — Approver identity · set when Approve is clicked · triggers Status → Active';
COMMENT ON COLUMN loans.approved_at IS
  'C2 — timestamp of approval';
COMMENT ON COLUMN loans.rejection_reason IS
  'C2 — populated when Approver rejects the submission · Status stays Draft, submitted_at cleared';
