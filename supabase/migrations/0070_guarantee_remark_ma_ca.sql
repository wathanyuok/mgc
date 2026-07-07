-- =====================================================================
-- Migration 0070 — Add `guarantee_remark` to master_agreements + credit_agreements
-- =====================================================================
-- Section-level remark for the Guarantee tab (below "Add Guarantor" button).
-- Different from ma_guarantors.remark (which is per-row · per person/corp).
--
-- Purpose:
--   - Store "Joint and Several" or "Limited" guarantee-scope conditions
--   - Any special guarantee terms that span all guarantors of the agreement
--
-- Applied tables:
--   master_agreements.guarantee_remark  (existing UI had guarRemark useState · was not persisted)
--   credit_agreements.guarantee_remark  (new · added for consistency with MA)
-- =====================================================================

BEGIN;

ALTER TABLE master_agreements ADD COLUMN IF NOT EXISTS guarantee_remark text;
ALTER TABLE credit_agreements ADD COLUMN IF NOT EXISTS guarantee_remark text;

COMMENT ON COLUMN master_agreements.guarantee_remark IS
  'Section-level guarantee remark for Guarantee tab · เงื่อนไขค้ำแบบรวมของสัญญา (Joint and Several · Limited · Continuing · ฯลฯ) · ต่างจาก ma_guarantors.remark ที่เป็น per-row';

COMMENT ON COLUMN credit_agreements.guarantee_remark IS
  'Section-level guarantee remark for Guarantee tab · เงื่อนไขค้ำแบบรวมของ CA · ต่างจาก ca_guarantors.remark ที่เป็น per-row';

COMMIT;

-- =====================================================================
-- Verify:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name IN ('master_agreements','credit_agreements')
--    AND column_name = 'guarantee_remark';
-- =====================================================================
