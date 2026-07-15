-- =====================================================================
--  Facility Types Master
--  ---------------------------------------------------------------------
--  Replaces hardcoded CA_FACILITY_TYPES array in src/types/database.ts.
--  Allows admin-managed list (sort, active) + bilingual display (EN/TH).
--
--  Codes (uppercase, stable) mirror the values used in
--  bank_statement_lines.facility_type CHECK constraint so we can move to
--  a FK-based reference for that table later (Phase 2).
-- =====================================================================

CREATE TABLE IF NOT EXISTS facility_types (
  id          UUID          NOT NULL DEFAULT uuid_generate_v4(),
  code        VARCHAR(20)   NOT NULL,
  name_en     VARCHAR(100)  NOT NULL,
  name_th     VARCHAR(100),
  sort_order  SMALLINT      NOT NULL DEFAULT 0,
  active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES app_users(id),
  updated_by  UUID REFERENCES app_users(id),
  CONSTRAINT pk_facility_types PRIMARY KEY (id),
  CONSTRAINT uk_facility_types_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_facility_types_active_sort
  ON facility_types(active, sort_order);

COMMENT ON TABLE facility_types IS
  'Master list of Credit Agreement facility types (admin-managed).';
COMMENT ON COLUMN facility_types.code IS
  'Stable short code (uppercase). Referenced by application logic.';
COMMENT ON COLUMN facility_types.name_en IS
  'English display name shown in dropdowns.';
COMMENT ON COLUMN facility_types.name_th IS
  'Thai display name (optional).';
COMMENT ON COLUMN facility_types.sort_order IS
  'Display order in dropdown (ascending). Lower = shown first.';

-- ---------------------------------------------------------------------
-- Seed 11 rows matching existing CA_FACILITY_TYPES hardcoded array.
-- Order mirrors the current dropdown order in CADetail.tsx.
-- ---------------------------------------------------------------------
INSERT INTO facility_types (code, name_en, name_th, sort_order) VALUES
  ('HP',    'Hire Purchase',           'เช่าซื้อ',                                  1),
  ('PN',    'P/N',                     'ตั๋วสัญญาใช้เงิน',                          2),
  ('OD',    'O/D',                     'เบิกเกินบัญชี',                             3),
  ('TR',    'T/R',                     'ทรัสต์รีซีท',                              4),
  ('FP',    'Floor Plan',              'สินเชื่อค้าดีลเลอร์',                       5),
  ('LG',    'LG/BG',                   'หนังสือค้ำประกัน',                         6),
  ('FXF',   'FX Forward',              'สัญญาซื้อขายเงินตราต่างประเทศล่วงหน้า',    7),
  ('LEASE', 'Lease',                   'สัญญาเช่า',                                8),
  ('LC',    'LC (Letter of Credit)',   'เลตเตอร์ออฟเครดิต',                        9),
  ('LOAN',  'Loan',                    'เงินกู้',                                  10),
  ('SBLC',  'SBLC (Standby LC)',       'สแตนด์บายเลตเตอร์ออฟเครดิต',              11)
ON CONFLICT (code) DO NOTHING;

-- RLS
ALTER TABLE facility_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_facility_types" ON facility_types;
CREATE POLICY "anon_all_facility_types" ON facility_types
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger to auto-update updated_at (idempotent)
DROP TRIGGER IF EXISTS trg_facility_types_updated ON facility_types;
CREATE TRIGGER trg_facility_types_updated
  BEFORE UPDATE ON facility_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
