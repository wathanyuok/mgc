-- 0051_segment_fks.sql
-- Wire Financial Segment FKs to existing tables (MA / CA / Transactions)
-- Per MoM_Loan_Lease_Workshop §6 + meeting transcript cascade pattern:
--   MA       → subsidiary_id (master)
--   CA       → class_id      (default for transactions)
--   Trans    → department_id + location_id (per Drawdown)
--
-- Pattern: ทุก FK เป็น nullable · เพราะ MoM §39 "ฟิลด์ Segment เปิดให้กรอก ไม่บังคับครบ"

-- =====================================================================
-- 1. MASTER AGREEMENT — Subsidiary (ระดับธนาคาร)
-- =====================================================================
ALTER TABLE master_agreements
  ADD COLUMN IF NOT EXISTS subsidiary_id UUID REFERENCES subsidiaries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ma_subsidiary ON master_agreements(subsidiary_id);

COMMENT ON COLUMN master_agreements.subsidiary_id IS 'GL Segment col 7 Subsidiary. Cascade default ไปยัง CA + Transaction.';

-- =====================================================================
-- 2. CREDIT AGREEMENT — Class (default ลงไปยัง Transaction)
-- =====================================================================
ALTER TABLE credit_agreements
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ca_class ON credit_agreements(class_id);

COMMENT ON COLUMN credit_agreements.class_id IS 'GL Segment col 17 Business Type. Default ลงไปยัง Transactions.';

-- =====================================================================
-- 3. TRANSACTIONS — Department + Location + Override Class (per drawdown)
-- =====================================================================
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY['loans', 'leases', 'promissory_notes', 'floor_plans',
                            'overdrafts', 'trust_receipts', 'letters_of_credit',
                            'letter_guarantees', 'fx_forwards'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    -- Department FK
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL',
      v_table
    );
    -- Location FK
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL',
      v_table
    );
    -- Class override (เผื่อ override จาก CA default)
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS class_id_override UUID REFERENCES classes(id) ON DELETE SET NULL',
      v_table
    );
    -- Index
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_department ON %I(department_id)', v_table, v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_location   ON %I(location_id)',   v_table, v_table);
    RAISE NOTICE 'Added segment FKs to %', v_table;
  END LOOP;
END $$;

-- Note: Subsidiary + RPT inherited from MA → CA → Transaction · ไม่ต้องเก็บซ้ำ
-- Note: Chassis อยู่ใน Collateral table อยู่แล้ว · ไม่ต้องเพิ่มที่ Transaction
