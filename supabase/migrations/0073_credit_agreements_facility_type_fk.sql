-- =====================================================================
--  credit_agreements.facility_type → facility_type_id UUID FK
--  IDEMPOTENT (uses pg_temp function pattern for safe re-run)
-- =====================================================================

ALTER TABLE credit_agreements
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

-- Backfill via temp function (skips safely if old column already dropped)
CREATE OR REPLACE FUNCTION pg_temp.backfill_ca_073() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_agreements' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0073: credit_agreements.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  EXECUTE 'UPDATE credit_agreements ca SET facility_type_id = ft.id FROM facility_types ft WHERE ca.facility_type_id IS NULL AND ft.code = CASE ca.facility_type::text '
    'WHEN ''HP'' THEN ''HP'' '
    'WHEN ''PN'' THEN ''PN'' '
    'WHEN ''OD'' THEN ''OD'' '
    'WHEN ''TR'' THEN ''TR'' '
    'WHEN ''FP'' THEN ''FP'' '
    'WHEN ''LG'' THEN ''LG'' '
    'WHEN ''FXF'' THEN ''FXF'' '
    'WHEN ''Lease'' THEN ''LEASE'' '
    'WHEN ''LC'' THEN ''LC'' '
    'WHEN ''Loan'' THEN ''LOAN'' '
    'WHEN ''SBLC'' THEN ''SBLC'' '
    'WHEN ''Hire Purchase'' THEN ''HP'' '
    'WHEN ''P/N'' THEN ''PN'' '
    'WHEN ''O/D'' THEN ''OD'' '
    'WHEN ''T/R'' THEN ''TR'' '
    'WHEN ''Floor Plan'' THEN ''FP'' '
    'WHEN ''LG/BG'' THEN ''LG'' '
    'WHEN ''FX Forward'' THEN ''FXF'' '
    'WHEN ''LC (Letter of Credit)'' THEN ''LC'' '
    'WHEN ''SBLC (Standby LC)'' THEN ''SBLC'' '
    'ELSE NULL END';

  IF (SELECT COUNT(*) FROM credit_agreements WHERE facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0073 backfill failed: some rows unmapped';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_ca_073();

-- Add NOT NULL + FK (idempotent)
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_ca_facility_type'
  ) THEN
    ALTER TABLE credit_agreements
      ALTER COLUMN facility_type_id SET NOT NULL,
      ADD CONSTRAINT fk_ca_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_ca_facility_type_id
  ON credit_agreements(facility_type_id);

ALTER TABLE credit_agreements
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN credit_agreements.facility_type_id IS
  'FK to facility_types.id.';
