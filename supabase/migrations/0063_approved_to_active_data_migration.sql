-- =====================================================================
-- Migration 0063 — data migration: status 'Approved' → 'Active'
-- =====================================================================
-- Rationale (from C2 Maker/Checker/Approver rollout):
--   'Approved' is a WORKFLOW GATE, not a business status.
--   ApprovalPanel now owns the Approved transition — when Approver clicks
--   'อนุมัติ', status auto-transitions to 'Active' via `approvedValue`.
--
--   The dropdown was cleaned up to show only real business states
--   (Draft / Active / Modified / Closed / Cancelled / Roll Over / Repaid).
--
-- Legacy rows with status='Approved' (created before C2) need to be moved
-- to 'Active' so they render correctly in the new dropdown.
--
-- This is a DATA migration — the enum value 'Approved' is kept in the type
-- so any reports/history queries still resolve. No structural change.
--
-- Idempotent: only touches rows where status = 'Approved'.
-- =====================================================================

BEGIN;

-- 1. Loans — status field is text-like enum
UPDATE loans             SET status = 'Active' WHERE status::text = 'Approved';
-- 2. Promissory Notes (pn_status)
UPDATE promissory_notes  SET status = 'Active' WHERE status::text = 'Approved';
-- 3. Floor Plans (fp_status)
UPDATE floor_plans       SET status = 'Active' WHERE status::text = 'Approved';
-- 4. Overdrafts (od_status)
UPDATE overdrafts        SET status = 'Active' WHERE status::text = 'Approved';
-- 5. Trust Receipts (tr_status)
UPDATE trust_receipts    SET status = 'Active' WHERE status::text = 'Approved';
-- 6. Letter Guarantees (lg_status)
UPDATE letter_guarantees SET status = 'Active' WHERE status::text = 'Approved';
-- 7. Letters of Credit (lc_status)
UPDATE letters_of_credit SET status = 'Active' WHERE status::text = 'Approved';
-- 8. Leases (lease_status)
UPDATE leases            SET status = 'Active' WHERE status::text = 'Approved';
-- 9. FX Forwards (fxf_status)
UPDATE fx_forwards       SET status = 'Active' WHERE status::text = 'Approved';

-- Report counts (for audit — user sees this in Supabase SQL Editor result)
SELECT
  'loans'             AS table_name, count(*) AS remaining_approved FROM loans             WHERE status::text = 'Approved'
UNION ALL SELECT 'promissory_notes',  count(*) FROM promissory_notes  WHERE status::text = 'Approved'
UNION ALL SELECT 'floor_plans',       count(*) FROM floor_plans       WHERE status::text = 'Approved'
UNION ALL SELECT 'overdrafts',        count(*) FROM overdrafts        WHERE status::text = 'Approved'
UNION ALL SELECT 'trust_receipts',    count(*) FROM trust_receipts    WHERE status::text = 'Approved'
UNION ALL SELECT 'letter_guarantees', count(*) FROM letter_guarantees WHERE status::text = 'Approved'
UNION ALL SELECT 'letters_of_credit', count(*) FROM letters_of_credit WHERE status::text = 'Approved'
UNION ALL SELECT 'leases',            count(*) FROM leases            WHERE status::text = 'Approved'
UNION ALL SELECT 'fx_forwards',       count(*) FROM fx_forwards       WHERE status::text = 'Approved';

COMMIT;

-- =====================================================================
-- Post-check (expected result): all rows show remaining_approved = 0
-- =====================================================================
