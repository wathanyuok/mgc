-- =====================================================================
--  Phase 2 · fa_transfers.facility_type → facility_type_id UUID FK
--  Split 'lease' → HP/LEASE by leases.mode.
--  IDEMPOTENT (pg_temp function pattern)
-- =====================================================================

ALTER TABLE fa_transfers
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_fat_077() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fa_transfers' AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0077: fa_transfers.facility_type already dropped — skipping backfill';
    RETURN;
  END IF;

  -- floor_plan → FP
  EXECUTE 'UPDATE fa_transfers SET facility_type_id = (SELECT id FROM facility_types WHERE code = ''FP'') WHERE facility_type = ''floor_plan'' AND facility_type_id IS NULL';

  -- lease → HP/LEASE based on leases.mode
  EXECUTE 'UPDATE fa_transfers fa SET facility_type_id = ft.id FROM leases l, facility_types ft WHERE fa.facility_type = ''lease'' AND fa.facility_type_id IS NULL AND fa.facility_id = l.id AND ft.code = CASE l.mode WHEN ''hp'' THEN ''HP'' ELSE ''LEASE'' END';

  -- fallback: orphan 'lease' rows → LEASE
  EXECUTE 'UPDATE fa_transfers SET facility_type_id = (SELECT id FROM facility_types WHERE code = ''LEASE'') WHERE facility_type = ''lease'' AND facility_type_id IS NULL';

  IF (SELECT COUNT(*) FROM fa_transfers WHERE facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0077 backfill failed';
  END IF;
END;
$func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_fat_077();

DROP INDEX IF EXISTS idx_fa_transfers_facility;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fat_facility_type'
  ) THEN
    ALTER TABLE fa_transfers
      ALTER COLUMN facility_type_id SET NOT NULL,
      ADD CONSTRAINT fk_fat_facility_type
        FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_fa_transfers_facility
  ON fa_transfers(facility_type_id, facility_id);

ALTER TABLE fa_transfers
  DROP COLUMN IF EXISTS facility_type;

COMMENT ON COLUMN fa_transfers.facility_type_id IS
  'FK to facility_types.id (Migration 0077).';
