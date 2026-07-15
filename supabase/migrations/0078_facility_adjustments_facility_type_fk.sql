-- =====================================================================
--  Phase 2 · facility_adjustments.facility_type → facility_type_id UUID FK
--  IDEMPOTENT (pg_temp function pattern)
-- =====================================================================

ALTER TABLE facility_adjustments
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_fac_adj_078() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facility_adjustments' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0078: facility_adjustments.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  EXECUTE 'UPDATE facility_adjustments fa SET facility_type_id = ft.id FROM facility_types ft WHERE fa.facility_type_id IS NULL AND ft.code = CASE fa.facility_type::text '
    'WHEN ''Loan'' THEN ''LOAN'' '
    'WHEN ''PN'' THEN ''PN'' '
    'WHEN ''P/N'' THEN ''PN'' '
    'WHEN ''FP'' THEN ''FP'' '
    'WHEN ''OD'' THEN ''OD'' '
    'WHEN ''TR'' THEN ''TR'' '
    'ELSE NULL END';

  IF (SELECT COUNT(*) FROM facility_adjustments WHERE facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0078 backfill failed';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_fac_adj_078();

DROP INDEX IF EXISTS idx_facility_adjustments_facility;
DROP INDEX IF EXISTS idx_facility_adjustments_period;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fac_adj_facility_type'
  ) THEN
    ALTER TABLE facility_adjustments
      ALTER COLUMN facility_type_id SET NOT NULL,
      ADD CONSTRAINT fk_fac_adj_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_facility_adjustments_facility
  ON facility_adjustments(facility_type_id, facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_adjustments_period
  ON facility_adjustments(facility_type_id, facility_id, period);

ALTER TABLE facility_adjustments
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN facility_adjustments.facility_type_id IS
  'FK to facility_types.id (Migration 0078).';
