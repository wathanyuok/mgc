-- =====================================================================
--  Phase 2 · repayments.facility_type → facility_type_id UUID FK
--  IDEMPOTENT (pg_temp function pattern)
-- =====================================================================

ALTER TABLE repayments
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_rep_076() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'repayments' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0076: repayments.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  EXECUTE 'UPDATE repayments r SET facility_type_id = ft.id FROM facility_types ft WHERE r.facility_type IS NOT NULL AND r.facility_type_id IS NULL AND ft.code = CASE r.facility_type::text '
    'WHEN ''PN'' THEN ''PN'' '
    'WHEN ''P/N'' THEN ''PN'' '
    'WHEN ''LG'' THEN ''LG'' '
    'WHEN ''BG'' THEN ''LG'' '
    'WHEN ''LC'' THEN ''LC'' '
    'WHEN ''FP'' THEN ''FP'' '
    'WHEN ''OD'' THEN ''OD'' '
    'WHEN ''TR'' THEN ''TR'' '
    'WHEN ''FXF'' THEN ''FXF'' '
    'WHEN ''Loan'' THEN ''LOAN'' '
    'WHEN ''loan'' THEN ''LOAN'' '
    'WHEN ''LOAN'' THEN ''LOAN'' '
    'WHEN ''HP'' THEN ''HP'' '
    'WHEN ''Lease'' THEN ''LEASE'' '
    'WHEN ''lease'' THEN ''LEASE'' '
    'WHEN ''LEASE'' THEN ''LEASE'' '
    'ELSE NULL END';

  IF (SELECT COUNT(*) FROM repayments WHERE facility_type IS NOT NULL AND facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0076 backfill failed';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_rep_076();

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_rep_facility_type'
  ) THEN
    ALTER TABLE repayments
      ADD CONSTRAINT fk_rep_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_rep_facility_type_id
  ON repayments(facility_type_id);

ALTER TABLE repayments
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN repayments.facility_type_id IS
  'FK to facility_types.id (Migration 0076).';
