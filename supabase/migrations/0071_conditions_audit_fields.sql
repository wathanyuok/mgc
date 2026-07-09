-- 0071_conditions_audit_fields.sql
-- Restructure ma_conditions and ca_conditions to standard `id UUID PK + FK UNIQUE` pattern
-- consistent with ma_collaterals · ma_guarantors · ca_collaterals · ca_guarantors etc.
--
-- Changes:
--   1. Add id UUID PK (surrogate key)
--   2. Change ma_id/ca_id from PK → UNIQUE FK NOT NULL (still enforces 1:1)
--   3. Add audit fields (created_at, created_by, updated_at, updated_by)

-- ============================================================
-- MA Conditions
-- ============================================================

-- 1. Add id column (nullable first, then populate)
ALTER TABLE ma_conditions
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();

-- 2. Backfill id for existing rows
UPDATE ma_conditions SET id = uuid_generate_v4() WHERE id IS NULL;

-- 3. Set NOT NULL
ALTER TABLE ma_conditions ALTER COLUMN id SET NOT NULL;

-- 4. Drop old PK on ma_id + set new PK on id
ALTER TABLE ma_conditions DROP CONSTRAINT IF EXISTS ma_conditions_pkey;
ALTER TABLE ma_conditions ADD CONSTRAINT ma_conditions_pkey PRIMARY KEY (id);

-- 5. Add UNIQUE on ma_id (still enforces 1:1)
ALTER TABLE ma_conditions ADD CONSTRAINT ma_conditions_ma_id_key UNIQUE (ma_id);

-- 6. Add audit fields
ALTER TABLE ma_conditions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_users(id);

-- ============================================================
-- CA Conditions
-- ============================================================

-- 1. Add id column
ALTER TABLE ca_conditions
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4();

-- 2. Backfill id
UPDATE ca_conditions SET id = uuid_generate_v4() WHERE id IS NULL;

-- 3. Set NOT NULL
ALTER TABLE ca_conditions ALTER COLUMN id SET NOT NULL;

-- 4. Drop old PK + set new PK
ALTER TABLE ca_conditions DROP CONSTRAINT IF EXISTS ca_conditions_pkey;
ALTER TABLE ca_conditions ADD CONSTRAINT ca_conditions_pkey PRIMARY KEY (id);

-- 5. Add UNIQUE on ca_id
ALTER TABLE ca_conditions ADD CONSTRAINT ca_conditions_ca_id_key UNIQUE (ca_id);

-- 6. Add audit fields
ALTER TABLE ca_conditions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_users(id);
