-- =====================================================================
-- Migration 0066 — Normalize ma_guarantors + ca_guarantors
-- (JSONB → explicit columns)
-- =====================================================================
-- Aligns DB schema with DBML (production-normalized) for BOTH guarantor tables:
--   ma_guarantors + ca_guarantors — same shape · same treatment
--
-- Adds explicit columns for: name · company_name · id_card_or_tax_id · position
--                            · amount · expiry_date · phone · address · remark
-- Copies data from `fields` JSONB into new columns (idempotent)
-- Keeps `fields` JSONB for now as read-only fallback (drop later if unused)
--
-- Dev อ่าน dbdocs.io → เห็น column ตรงๆ → เขียน query ปกติได้
-- ไม่มี breaking change — code เดิมที่ read `fields` JSONB ยังทำงานได้
-- =====================================================================

BEGIN;

-- ── 1. Add new explicit columns (idempotent) ──────────────────────
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS name              varchar(200);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS company_name      varchar(200);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS id_card_or_tax_id varchar(40);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS position          varchar(100);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS amount            decimal(18,2);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS expiry_date       date;
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS phone             varchar(30);
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS address           text;
ALTER TABLE ma_guarantors ADD COLUMN IF NOT EXISTS remark            text;

-- ── 2. Backfill from JSONB `fields` (only rows where new columns are NULL) ──
UPDATE ma_guarantors
   SET name              = COALESCE(name,              fields->>'name'),
       company_name      = COALESCE(company_name,      fields->>'company'),
       id_card_or_tax_id = COALESCE(id_card_or_tax_id, fields->>'tax_id'),
       position          = COALESCE(position,          fields->>'position'),
       amount            = COALESCE(amount,            NULLIF(fields->>'amount','')::decimal(18,2)),
       expiry_date       = COALESCE(expiry_date,       NULLIF(fields->>'expiry_date','')::date),
       phone             = COALESCE(phone,             fields->>'phone'),
       address           = COALESCE(address,           fields->>'address'),
       remark            = COALESCE(remark,            fields->>'remark')
 WHERE fields IS NOT NULL
   AND fields <> '{}'::jsonb;

-- ── 3. Rename JSONB legacy column (keep for rollback safety, mark deprecated) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ma_guarantors'
                AND column_name = 'fields') THEN
    -- keep column · comment as legacy
    COMMENT ON COLUMN ma_guarantors.fields IS
      'DEPRECATED — legacy prototype JSONB. Data migrated to explicit columns in migration 0066. Keep for rollback until confirmed stable.';
  END IF;
END $$;

-- ── 4. Add helpful indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ma_guarantors_expiry
  ON ma_guarantors(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ma_guarantors_taxid
  ON ma_guarantors(id_card_or_tax_id) WHERE id_card_or_tax_id IS NOT NULL;

-- ── 5. Column comments (rendered in DB tooling + dbdocs) ─────────────
COMMENT ON COLUMN ma_guarantors.name              IS 'บุคคล = ชื่อ-นามสกุล · นิติบุคคล = ชื่อผู้มีอำนาจลงนาม (Authorized Signatory)';
COMMENT ON COLUMN ma_guarantors.company_name      IS 'เฉพาะนิติบุคคล — ชื่อบริษัท/นิติบุคคลค้ำประกัน';
COMMENT ON COLUMN ma_guarantors.id_card_or_tax_id IS 'บุคคล = เลขบัตรประชาชน 13 หลัก · นิติบุคคล = เลขทะเบียนนิติบุคคล 13 หลัก';
COMMENT ON COLUMN ma_guarantors.position          IS 'ตำแหน่ง เช่น กรรมการผู้จัดการ / กรรมการ / ผู้ถือหุ้น';
COMMENT ON COLUMN ma_guarantors.amount            IS 'วงเงินค้ำประกัน (บาท)';
COMMENT ON COLUMN ma_guarantors.expiry_date       IS 'วันหมดอายุการค้ำประกัน (ถ้ามี)';
COMMENT ON COLUMN ma_guarantors.phone             IS 'เบอร์ติดต่อ';
COMMENT ON COLUMN ma_guarantors.address           IS 'ที่อยู่ · บุคคล = ตามบัตรประชาชน · นิติบุคคล = ที่อยู่จดทะเบียน';
COMMENT ON COLUMN ma_guarantors.remark            IS 'หมายเหตุเพิ่มเติม';

-- =====================================================================
-- ── PART 2 · ca_guarantors — same treatment ──────────────────────────
-- =====================================================================
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS name              varchar(200);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS company_name      varchar(200);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS id_card_or_tax_id varchar(40);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS position          varchar(100);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS amount            decimal(18,2);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS expiry_date       date;
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS phone             varchar(30);
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS address           text;
ALTER TABLE ca_guarantors ADD COLUMN IF NOT EXISTS remark            text;

UPDATE ca_guarantors
   SET name              = COALESCE(name,              fields->>'name'),
       company_name      = COALESCE(company_name,      fields->>'company'),
       id_card_or_tax_id = COALESCE(id_card_or_tax_id, fields->>'tax_id'),
       position          = COALESCE(position,          fields->>'position'),
       amount            = COALESCE(amount,            NULLIF(fields->>'amount','')::decimal(18,2)),
       expiry_date       = COALESCE(expiry_date,       NULLIF(fields->>'expiry_date','')::date),
       phone             = COALESCE(phone,             fields->>'phone'),
       address           = COALESCE(address,           fields->>'address'),
       remark            = COALESCE(remark,            fields->>'remark')
 WHERE fields IS NOT NULL
   AND fields <> '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ca_guarantors' AND column_name = 'fields') THEN
    COMMENT ON COLUMN ca_guarantors.fields IS
      'DEPRECATED — legacy prototype JSONB. Data migrated to explicit columns in migration 0066.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ca_guarantors_expiry
  ON ca_guarantors(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ca_guarantors_taxid
  ON ca_guarantors(id_card_or_tax_id) WHERE id_card_or_tax_id IS NOT NULL;

COMMENT ON COLUMN ca_guarantors.name              IS 'บุคคล = ชื่อ-นามสกุล · นิติบุคคล = ชื่อผู้มีอำนาจลงนาม (Authorized Signatory)';
COMMENT ON COLUMN ca_guarantors.company_name      IS 'เฉพาะนิติบุคคล — ชื่อบริษัท/นิติบุคคลค้ำประกัน';
COMMENT ON COLUMN ca_guarantors.id_card_or_tax_id IS 'บุคคล = เลขบัตรประชาชน 13 หลัก · นิติบุคคล = เลขทะเบียนนิติบุคคล 13 หลัก';
COMMENT ON COLUMN ca_guarantors.position          IS 'ตำแหน่ง เช่น กรรมการผู้จัดการ / กรรมการ / ผู้ถือหุ้น';
COMMENT ON COLUMN ca_guarantors.amount            IS 'วงเงินค้ำประกัน (บาท)';
COMMENT ON COLUMN ca_guarantors.expiry_date       IS 'วันหมดอายุการค้ำประกัน (ถ้ามี)';
COMMENT ON COLUMN ca_guarantors.phone             IS 'เบอร์ติดต่อ';
COMMENT ON COLUMN ca_guarantors.address           IS 'ที่อยู่ · บุคคล = ตามบัตรประชาชน · นิติบุคคล = ที่อยู่จดทะเบียน';
COMMENT ON COLUMN ca_guarantors.remark            IS 'หมายเหตุเพิ่มเติม';

COMMIT;

-- =====================================================================
-- Verify (run after apply):
-- =====================================================================
-- SELECT column_name, data_type, character_maximum_length, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'ma_guarantors'
--  ORDER BY ordinal_position;
--
-- SELECT id, name, company_name, position, expiry_date, phone,
--        left(address, 30) AS addr_preview, remark, fields
--   FROM ma_guarantors
--  LIMIT 10;
--
-- Sanity: rows with fields but new columns still NULL (should be 0)
-- SELECT count(*) FROM ma_guarantors
--  WHERE fields IS NOT NULL AND fields <> '{}'::jsonb
--    AND (
--      (fields->>'name'     IS NOT NULL AND name     IS NULL) OR
--      (fields->>'position' IS NOT NULL AND position IS NULL) OR
--      (fields->>'phone'    IS NOT NULL AND phone    IS NULL)
--    );
--
-- =====================================================================
-- Follow-up migration (later · after code updated to write to columns):
--   ALTER TABLE ma_guarantors DROP COLUMN fields;
-- =====================================================================
