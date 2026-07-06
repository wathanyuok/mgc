-- =====================================================================
-- Migration 0067 — Normalize ma_collaterals + ca_collaterals
-- (JSONB → explicit columns for all 5 sub-types)
-- =====================================================================
-- Follows same pattern as 0066 (guarantors normalization):
--   Add explicit columns for all 20 fields across 5 sub-types
--   Backfill from `fields` JSONB (idempotent)
--   Keep `fields` JSONB as legacy fallback (drop later)
--
-- Sub-type field map:
--   realestate:  asset_no, doc_no, location, value, appraisal, appr_date, mortgage_limit
--   vehicle:     asset_no, chassis_no, vreg, vmodel, value, appraisal, appr_date, pledge
--   deposit:     bank, acct_no, acct_name, deposit_amt, pledge_amt
--   business:    asset_no, desc_, reg_no, value, appraisal, appr_date, reg_limit
--   other:       desc_, value, appraisal, appr_date, secured_limit
--
-- Rationale (มายาก 20 col เพราะ):
--   - Each sub-type has ~5-8 fields · dev query per type ตรงๆ ได้
--   - Field-level index + audit + report ทำได้
--   - Prototype JSONB → production columns (ตาม memory rule)
-- =====================================================================

BEGIN;

-- ── PART 1 · ma_collaterals ──────────────────────────────────────
-- Base columns (ที่ DBML แสดงว่ามีแต่จริงๆ ยังไม่มี — 0001_init.sql เก็บใน fields JSONB)
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS description      varchar(255);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS amount           decimal(18,2);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS insurance_amount decimal(18,2);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS chassis_no       varchar(50);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS fa_asset_no      varchar(50);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS source           varchar(20) DEFAULT 'manual';

-- Common valuation
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS value            decimal(18,2);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS appraisal        decimal(18,2);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS appr_date        date;

-- FA linkage
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS asset_no         varchar(50);

-- Realestate
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS doc_no           varchar(50);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS location         varchar(255);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS mortgage_limit   decimal(18,2);

-- Vehicle
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS vreg             varchar(30);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS vmodel           varchar(120);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS pledge           decimal(18,2);

-- Deposit
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS bank             varchar(120);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS acct_no          varchar(50);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS acct_name        varchar(200);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS deposit_amt      decimal(18,2);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS pledge_amt       decimal(18,2);

-- Business
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS reg_no           varchar(50);
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS reg_limit        decimal(18,2);

-- Other / Business shared
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS desc_            text;
ALTER TABLE ma_collaterals ADD COLUMN IF NOT EXISTS secured_limit    decimal(18,2);

-- Backfill from JSONB (only rows where new column is NULL)
UPDATE ma_collaterals
   SET value          = COALESCE(value,          NULLIF(fields->>'value','')::decimal(18,2)),
       appraisal      = COALESCE(appraisal,      NULLIF(fields->>'appraisal','')::decimal(18,2)),
       appr_date      = COALESCE(appr_date,      NULLIF(fields->>'appr_date','')::date),
       asset_no       = COALESCE(asset_no,       fields->>'asset_no'),
       doc_no         = COALESCE(doc_no,         fields->>'doc_no'),
       location       = COALESCE(location,       fields->>'location'),
       mortgage_limit = COALESCE(mortgage_limit, NULLIF(fields->>'mortgage_limit','')::decimal(18,2)),
       vreg           = COALESCE(vreg,           fields->>'vreg'),
       vmodel         = COALESCE(vmodel,         fields->>'vmodel'),
       pledge         = COALESCE(pledge,         NULLIF(fields->>'pledge','')::decimal(18,2)),
       bank           = COALESCE(bank,           fields->>'bank'),
       acct_no        = COALESCE(acct_no,        fields->>'acct_no'),
       acct_name      = COALESCE(acct_name,      fields->>'acct_name'),
       deposit_amt    = COALESCE(deposit_amt,    NULLIF(fields->>'deposit_amt','')::decimal(18,2)),
       pledge_amt     = COALESCE(pledge_amt,     NULLIF(fields->>'pledge_amt','')::decimal(18,2)),
       reg_no         = COALESCE(reg_no,         fields->>'reg_no'),
       reg_limit      = COALESCE(reg_limit,      NULLIF(fields->>'reg_limit','')::decimal(18,2)),
       desc_          = COALESCE(desc_,          fields->>'desc'),
       secured_limit  = COALESCE(secured_limit,  NULLIF(fields->>'secured_limit','')::decimal(18,2))
 WHERE fields IS NOT NULL
   AND fields <> '{}'::jsonb;

-- Backfill source from fields._source
UPDATE ma_collaterals
   SET source = COALESCE(source, fields->>'_source', 'manual')
 WHERE (source IS NULL OR source = 'manual')
   AND fields->>'_source' IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ma_collaterals' AND column_name = 'fields') THEN
    COMMENT ON COLUMN ma_collaterals.fields IS
      'DEPRECATED — legacy prototype JSONB. Data migrated to explicit columns in migration 0067.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ma_collaterals_type
  ON ma_collaterals(type);
CREATE INDEX IF NOT EXISTS idx_ma_collaterals_asset_no
  ON ma_collaterals(asset_no) WHERE asset_no IS NOT NULL;


-- ── PART 2 · ca_collaterals — same treatment ─────────────────────
-- Base columns
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS description      varchar(255);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS amount           decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS insurance_amount decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS chassis_no       varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS fa_asset_no      varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS source           varchar(20) DEFAULT 'manual';
-- Common valuation
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS value            decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS appraisal        decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS appr_date        date;
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS asset_no         varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS doc_no           varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS location         varchar(255);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS mortgage_limit   decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS vreg             varchar(30);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS vmodel           varchar(120);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS pledge           decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS bank             varchar(120);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS acct_no          varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS acct_name        varchar(200);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS deposit_amt      decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS pledge_amt       decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS reg_no           varchar(50);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS reg_limit        decimal(18,2);
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS desc_            text;
ALTER TABLE ca_collaterals ADD COLUMN IF NOT EXISTS secured_limit    decimal(18,2);

UPDATE ca_collaterals
   SET value          = COALESCE(value,          NULLIF(fields->>'value','')::decimal(18,2)),
       appraisal      = COALESCE(appraisal,      NULLIF(fields->>'appraisal','')::decimal(18,2)),
       appr_date      = COALESCE(appr_date,      NULLIF(fields->>'appr_date','')::date),
       asset_no       = COALESCE(asset_no,       fields->>'asset_no'),
       doc_no         = COALESCE(doc_no,         fields->>'doc_no'),
       location       = COALESCE(location,       fields->>'location'),
       mortgage_limit = COALESCE(mortgage_limit, NULLIF(fields->>'mortgage_limit','')::decimal(18,2)),
       vreg           = COALESCE(vreg,           fields->>'vreg'),
       vmodel         = COALESCE(vmodel,         fields->>'vmodel'),
       pledge         = COALESCE(pledge,         NULLIF(fields->>'pledge','')::decimal(18,2)),
       bank           = COALESCE(bank,           fields->>'bank'),
       acct_no        = COALESCE(acct_no,        fields->>'acct_no'),
       acct_name      = COALESCE(acct_name,      fields->>'acct_name'),
       deposit_amt    = COALESCE(deposit_amt,    NULLIF(fields->>'deposit_amt','')::decimal(18,2)),
       pledge_amt     = COALESCE(pledge_amt,     NULLIF(fields->>'pledge_amt','')::decimal(18,2)),
       reg_no         = COALESCE(reg_no,         fields->>'reg_no'),
       reg_limit      = COALESCE(reg_limit,      NULLIF(fields->>'reg_limit','')::decimal(18,2)),
       desc_          = COALESCE(desc_,          fields->>'desc'),
       secured_limit  = COALESCE(secured_limit,  NULLIF(fields->>'secured_limit','')::decimal(18,2))
 WHERE fields IS NOT NULL
   AND fields <> '{}'::jsonb;

UPDATE ca_collaterals
   SET source = COALESCE(source, fields->>'_source', 'manual')
 WHERE (source IS NULL OR source = 'manual')
   AND fields->>'_source' IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ca_collaterals' AND column_name = 'fields') THEN
    COMMENT ON COLUMN ca_collaterals.fields IS
      'DEPRECATED — legacy prototype JSONB. Data migrated to explicit columns in migration 0067.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ca_collaterals_type
  ON ca_collaterals(type);
CREATE INDEX IF NOT EXISTS idx_ca_collaterals_asset_no
  ON ca_collaterals(asset_no) WHERE asset_no IS NOT NULL;

COMMIT;

-- =====================================================================
-- Verify (run after apply):
-- =====================================================================
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name IN ('ma_collaterals','ca_collaterals')
--  ORDER BY table_name, ordinal_position;
--
-- Sanity: rows where JSONB has value but new column is NULL (should be 0)
-- SELECT count(*) FROM ma_collaterals
--  WHERE fields <> '{}'::jsonb
--    AND fields->>'value' IS NOT NULL AND value IS NULL;
-- =====================================================================
