-- =====================================================================
--  Phase 2 · bank_statement_lines.facility_type → facility_type_id UUID FK
--  IDEMPOTENT (pg_temp function pattern)
-- =====================================================================

ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_bsl_074() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bank_statement_lines' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0074: bank_statement_lines.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  EXECUTE 'UPDATE bank_statement_lines bsl SET facility_type_id = ft.id FROM facility_types ft WHERE bsl.facility_type IS NOT NULL AND bsl.facility_type_id IS NULL AND ft.code = CASE bsl.facility_type::text '
    'WHEN ''P/N'' THEN ''PN'' '
    'WHEN ''LG'' THEN ''LG'' '
    'WHEN ''LC'' THEN ''LC'' '
    'WHEN ''FP'' THEN ''FP'' '
    'WHEN ''OD'' THEN ''OD'' '
    'WHEN ''TR'' THEN ''TR'' '
    'WHEN ''FXF'' THEN ''FXF'' '
    'WHEN ''Loan'' THEN ''LOAN'' '
    'WHEN ''HP'' THEN ''HP'' '
    'WHEN ''Lease'' THEN ''LEASE'' '
    'ELSE NULL END';

  IF (SELECT COUNT(*) FROM bank_statement_lines WHERE facility_type IS NOT NULL AND facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0074 backfill failed';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_bsl_074();

DROP INDEX IF EXISTS uq_bank_line_facility;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bsl_facility_type'
  ) THEN
    ALTER TABLE bank_statement_lines
      ADD CONSTRAINT fk_bsl_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_bsl_facility_type_id
  ON bank_statement_lines(facility_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_line_facility
  ON bank_statement_lines(facility_type_id, facility_id, source_period)
  WHERE facility_type_id IS NOT NULL;

ALTER TABLE bank_statement_lines
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN bank_statement_lines.facility_type_id IS
  'FK to facility_types.id (Migration 0074).';
