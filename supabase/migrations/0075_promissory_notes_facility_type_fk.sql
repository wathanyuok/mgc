-- =====================================================================
--  Phase 2 · promissory_notes.facility_type → facility_type_id UUID FK
--  Legacy BG → LG.
--  IDEMPOTENT (pg_temp function pattern)
-- =====================================================================

ALTER TABLE promissory_notes
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_pn_075() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promissory_notes' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0075: promissory_notes.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  EXECUTE 'UPDATE promissory_notes pn SET facility_type_id = ft.id FROM facility_types ft WHERE pn.facility_type_id IS NULL AND ft.code = CASE pn.facility_type::text '
    'WHEN ''PN'' THEN ''PN'' '
    'WHEN ''LG'' THEN ''LG'' '
    'WHEN ''BG'' THEN ''LG'' '
    'WHEN ''FP'' THEN ''FP'' '
    'WHEN ''OD'' THEN ''OD'' '
    'WHEN ''TR'' THEN ''TR'' '
    'WHEN ''FXF'' THEN ''FXF'' '
    'WHEN ''Loan'' THEN ''LOAN'' '
    'WHEN ''Lease'' THEN ''LEASE'' '
    'WHEN ''HP'' THEN ''HP'' '
    'ELSE NULL END';

  IF (SELECT COUNT(*) FROM promissory_notes WHERE facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0075 backfill failed';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_pn_075();

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pn_facility_type'
  ) THEN
    ALTER TABLE promissory_notes
      ALTER COLUMN facility_type_id SET NOT NULL,
      ADD CONSTRAINT fk_pn_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_pn_facility_type_id
  ON promissory_notes(facility_type_id);

ALTER TABLE promissory_notes
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN promissory_notes.facility_type_id IS
  'FK to facility_types.id (Migration 0075). Legacy BG → LG.';
