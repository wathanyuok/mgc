-- 0046_vendor_master.sql
-- Vendor Master — Phase 2 implementation
-- Per MoM §3: "Vendor Master เก็บรายชื่อเจ้าหนี้/supplier ที่มีธุรกรรมซื้อขาย รวมถึงธนาคารและ
-- บริษัท leasing (เช่น BM Leasing, Honda Leasing) ก็อยู่ใน vendor master เช่นกัน"
--
-- Concept: NetSuite tracks all outbound payments by vendor (no contract concept).
-- This table is the centralized master so:
--   - AP cheques can map to a vendor
--   - Lessor payments (IFRS 16) can map to a lessor vendor
--   - Bank borrowings (PN/FP/OD/TR/LG) can map to bank vendor
--   - Future netsuite_vendor_id mapping holds the cross-system link

-- Drop legacy enum if present to extend with Phase 2 values
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_type') THEN
    -- Add Phase 2 values (idempotent)
    BEGIN
      ALTER TYPE vendor_type ADD VALUE IF NOT EXISTS 'bank';
      ALTER TYPE vendor_type ADD VALUE IF NOT EXISTS 'lessor';
      ALTER TYPE vendor_type ADD VALUE IF NOT EXISTS 'customer';
    EXCEPTION WHEN OTHERS THEN
      -- Older PG versions don't support IF NOT EXISTS on enum — silently skip
      NULL;
    END;
  ELSE
    CREATE TYPE vendor_type AS ENUM ('dealer', 'supplier', 'importer', 'bank', 'lessor', 'customer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vendors (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                VARCHAR(40) UNIQUE NOT NULL,
  name                VARCHAR(200) NOT NULL,
  tax_id              VARCHAR(20),
  vendor_type         vendor_type,
  -- Cross-system mapping
  netsuite_vendor_id  VARCHAR(40),
  -- Contact + classification
  contact_email       VARCHAR(120),
  contact_phone       VARCHAR(40),
  address             TEXT,
  remark              TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_vendors_type ON vendors(vendor_type) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_vendors_ns_id ON vendors(netsuite_vendor_id) WHERE netsuite_vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_tax ON vendors(tax_id) WHERE tax_id IS NOT NULL;

-- RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_vendors" ON vendors;
CREATE POLICY "anon_all_vendors" ON vendors FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- updated_at trigger (reuse standard set_updated_at function)
DROP TRIGGER IF EXISTS trg_vendors_updated ON vendors;
CREATE TRIGGER trg_vendors_updated
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- FK additions on facility tables — vendor_id references vendors.id
-- All optional (NULL = legacy / pre-Phase 2). Backfill via UI.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE leases       ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE loans        ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE ap_cheque_requests ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leases_vendor ON leases(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_vendor  ON loans(vendor_id)  WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_cheque_vendor ON ap_cheque_requests(vendor_id) WHERE vendor_id IS NOT NULL;

COMMENT ON TABLE vendors IS
  'Centralized Vendor Master (Phase 2 · Migration 0046) — banks, lessors, suppliers, customers. Maps to NetSuite vendor entity for all GL/AP integration.';
COMMENT ON COLUMN vendors.vendor_type IS
  'dealer / supplier / importer (Phase 1) · bank / lessor / customer (Phase 2 additions)';
COMMENT ON COLUMN vendors.netsuite_vendor_id IS
  'Cross-system link to NetSuite vendor record. Required before pushing JE/AP that references this vendor.';
COMMENT ON COLUMN leases.vendor_id IS
  'Lessor vendor (IFRS 16) — Phase 2 · NULL = legacy data uses leases.lessor_name text field';
COMMENT ON COLUMN loans.vendor_id IS
  'Lender bank vendor — Phase 2 · NULL = legacy data uses loans.finance_institution_id';
COMMENT ON COLUMN ap_cheque_requests.vendor_id IS
  'Cheque recipient vendor — Phase 2 · NULL = legacy data uses ap_cheque_requests.vendor_name text';
