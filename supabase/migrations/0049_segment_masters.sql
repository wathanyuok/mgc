-- 0049_segment_masters.sql
-- Financial Segment Master tables for Loan/Lease GL classification
-- Per MoM_Loan_Lease_Workshop §6 + §38-40
--
-- Pattern: เก็บ local mock ใน Phase 1 (stub) · swap เป็น NetSuite Lookup ใน Phase 2
-- Reference: vendors table (Migration 0046)
--
-- Coverage:
--   • subsidiaries — บริษัทย่อยในเครือ MGC (Million Auto, Master Car, etc.)
--   • departments — แผนกใน MGC (Accounting, Sales, IT, etc.)
--   • locations — สาขา (HQ, Bangkok, Chiang Mai, etc.)
--   • classes — Business Class (Direct Sales, Wholesale, Fleet, etc.)

-- =====================================================================
-- 1. SUBSIDIARIES — บริษัทย่อยในกลุ่ม MGC
-- =====================================================================
CREATE TABLE IF NOT EXISTS subsidiaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) UNIQUE NOT NULL,
  name            VARCHAR(200) NOT NULL,
  tax_id          VARCHAR(20),
  netsuite_subsidiary_id VARCHAR(80),  -- Phase 2: NetSuite mapping
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subsidiaries_code ON subsidiaries(code);
CREATE INDEX IF NOT EXISTS idx_subsidiaries_active ON subsidiaries(active);

COMMENT ON TABLE subsidiaries IS 'MGC group subsidiaries · sync from NetSuite Subsidiary Master (Phase 2). Per MoM §6.';

-- =====================================================================
-- 2. DEPARTMENTS — แผนกในองค์กร
-- =====================================================================
CREATE TABLE IF NOT EXISTS departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  parent_id       UUID REFERENCES departments(id) ON DELETE SET NULL,  -- รองรับ Department tree
  netsuite_department_id VARCHAR(80),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(active);

COMMENT ON TABLE departments IS 'GL Department Segment · sync from NetSuite Department Master.';

-- =====================================================================
-- 3. LOCATIONS — สาขา / จุด
-- =====================================================================
CREATE TABLE IF NOT EXISTS locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  subsidiary_id   UUID REFERENCES subsidiaries(id) ON DELETE SET NULL,
  netsuite_location_id VARCHAR(80),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(code);
CREATE INDEX IF NOT EXISTS idx_locations_subsidiary ON locations(subsidiary_id);

COMMENT ON TABLE locations IS 'GL Location Segment · สาขา.';

-- =====================================================================
-- 4. CLASSES — Business Class (Direct Sales, Wholesale, Fleet, etc.)
-- =====================================================================
CREATE TABLE IF NOT EXISTS classes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  netsuite_class_id VARCHAR(80),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_code ON classes(code);

COMMENT ON TABLE classes IS 'GL Class Segment · เทียบ NetSuite "Business Type" (GL Template col 17).';

-- =====================================================================
-- updated_at triggers (reuse existing trigger function)
-- =====================================================================
DROP TRIGGER IF EXISTS trg_subsidiaries_updated ON subsidiaries;
CREATE TRIGGER trg_subsidiaries_updated BEFORE UPDATE ON subsidiaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_departments_updated ON departments;
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_locations_updated ON locations;
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_classes_updated ON classes;
CREATE TRIGGER trg_classes_updated BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
