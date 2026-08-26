-- =====================================================================
--  0100 · การตัดชำระ + ตัวกันข้อมูลซ้ำระดับฐานข้อมูล
--
--  1) repayment_lines.facility_type_id — หน้าจอเขียนคอลัมน์นี้อยู่แล้วแต่ตารางไม่มี
--     ผลคือหน้าตัดชำระบันทึกไม่ผ่านเลย (ขึ้นข้อความว่าไม่พบคอลัมน์)
--     ตารางหัวรายการถูกแปลงเป็นรหัสอ้างอิงไปแล้ว แต่ตารางบรรทัดตกหล่น
--
--  2) กันบรรทัดใบแจ้งยอดธนาคารหนึ่งบรรทัดสร้างใบตัดชำระได้หลายใบ
--
--  3) กันใบสำคัญบัญชีซ้ำ เมื่อกดลงบัญชีพร้อมกันจาก 2 หน้าต่าง
--     เดิมกันไว้แค่ในหน้าจอ ฐานข้อมูลไม่ได้กัน
--
--  รันซ้ำได้ (idempotent)
-- =====================================================================

-- ── 1) repayment_lines.facility_type_id ────────────────────────────
ALTER TABLE repayment_lines
  ADD COLUMN IF NOT EXISTS facility_type_id UUID;

CREATE OR REPLACE FUNCTION pg_temp.backfill_rp_lines_100() RETURNS void AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'repayment_lines'
      AND column_name = 'facility_type'
  ) THEN
    RAISE NOTICE '0100: repayment_lines.facility_type ถูกลบไปแล้ว — ข้ามการย้ายข้อมูล';
    RETURN;
  END IF;

  EXECUTE '
    UPDATE repayment_lines l
       SET facility_type_id = ft.id
      FROM facility_types ft
     WHERE l.facility_type IS NOT NULL
       AND l.facility_type_id IS NULL
       AND ft.code = CASE l.facility_type::text
                       WHEN ''PN''    THEN ''PN''
                       WHEN ''P/N''   THEN ''PN''
                       WHEN ''LG''    THEN ''LG''
                       WHEN ''BG''    THEN ''LG''
                       WHEN ''LC''    THEN ''LC''
                       WHEN ''FP''    THEN ''FP''
                       WHEN ''OD''    THEN ''OD''
                       WHEN ''TR''    THEN ''TR''
                       WHEN ''FXF''   THEN ''FXF''
                       WHEN ''Loan''  THEN ''LOAN''
                       WHEN ''loan''  THEN ''LOAN''
                       WHEN ''LOAN''  THEN ''LOAN''
                       WHEN ''HP''    THEN ''HP''
                       WHEN ''Lease'' THEN ''LEASE''
                       WHEN ''lease'' THEN ''LEASE''
                       WHEN ''LEASE'' THEN ''LEASE''
                       ELSE NULL
                     END';

  IF (SELECT COUNT(*) FROM repayment_lines
       WHERE facility_type IS NOT NULL AND facility_type_id IS NULL) > 0 THEN
    RAISE EXCEPTION '0100: ย้ายข้อมูล repayment_lines ไม่ครบ — มีค่าประเภทวงเงินที่ไม่รู้จัก';
  END IF;
END $func$ LANGUAGE plpgsql;

SELECT pg_temp.backfill_rp_lines_100();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'repayment_lines'
      AND constraint_name = 'repayment_lines_facility_type_id_fkey'
  ) THEN
    ALTER TABLE repayment_lines
      ADD CONSTRAINT repayment_lines_facility_type_id_fkey
      FOREIGN KEY (facility_type_id) REFERENCES facility_types(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rp_lines_ft
  ON repayment_lines(facility_type_id);

-- คอลัมน์ข้อความเดิมยังเก็บไว้ก่อน เผื่อข้อมูลเก่าที่ยังไม่ได้ย้าย
-- ให้หน้าจอเขียนทั้งสองช่องไปพร้อมกันจนกว่าจะยืนยันว่าย้ายครบแล้ว
ALTER TABLE repayment_lines
  ALTER COLUMN facility_type DROP NOT NULL;


-- ── 2) บรรทัดใบแจ้งยอดธนาคาร 1 บรรทัด = ใบตัดชำระได้ใบเดียว ────────
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT bank_statement_line_id
      FROM repayments
     WHERE bank_statement_line_id IS NOT NULL
     GROUP BY bank_statement_line_id
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE WARNING '0100: มีบรรทัดใบแจ้งยอดที่ผูกกับใบตัดชำระมากกว่า 1 ใบอยู่ % รายการ — ข้ามการสร้างดัชนีกันซ้ำ ให้ล้างข้อมูลซ้ำก่อนแล้วรันใหม่', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_repayments_bank_line
      ON repayments(bank_statement_line_id)
      WHERE bank_statement_line_id IS NOT NULL;
  END IF;
END $$;


-- ── 3) กันใบสำคัญบัญชีซ้ำ ──────────────────────────────────────────
--  หนึ่งงานลงบัญชี = หนึ่งใบสำคัญ
--  ใบกลับรายการใช้ที่มาและงวดเดียวกับใบต้นเรื่อง จึงต้องคัดออกจากดัชนี
--  งวดที่เป็นค่าว่างต้องแทนด้วยเลขติดลบ ไม่งั้นฐานข้อมูลจะถือว่าไม่ซ้ำกัน
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT source_type, source_id, COALESCE(source_period, -1) AS p
      FROM journal_entries
     WHERE source_id IS NOT NULL
       AND status = 'Posted'
       AND COALESCE(is_reversal, false) = false
     GROUP BY source_type, source_id, COALESCE(source_period, -1)
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE WARNING '0100: มีใบสำคัญซ้ำอยู่ % ชุด — ข้ามการสร้างดัชนีกันซ้ำ ให้กลับรายการใบที่ซ้ำก่อนแล้วรันใหม่', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source_once
      ON journal_entries(source_type, source_id, COALESCE(source_period, -1))
      WHERE source_id IS NOT NULL
        AND status = 'Posted'
        AND COALESCE(is_reversal, false) = false;
  END IF;
END $$;


COMMENT ON COLUMN repayment_lines.facility_type_id IS
  'ประเภทวงเงินของบรรทัดนี้ — อ้างอิงทะเบียนประเภทวงเงิน (แทนคอลัมน์ข้อความเดิม)';
