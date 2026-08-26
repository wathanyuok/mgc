-- 0099: เพิ่มคอลัมน์ rpt (ประเภทคู่ค้า) ให้ตารางธุรกรรมทั้ง 9
--
-- ที่มา: หน้าจอทุกโมดูลมีช่อง Related Parties ให้เลือกอยู่แล้ว และแบบจำลองข้อมูล
-- ก็ระบุคอลัมน์นี้ไว้ครบทั้ง 9 ตาราง แต่ไม่เคยมีสคริปต์ไหนสร้างคอลัมน์จริง
-- ผลคือพอผู้ใช้เลือกประเภทคู่ค้าแล้วกดบันทึก จะพังทันทีเพราะหาคอลัมน์ไม่พบ
--
-- ค่าที่ใช้: External (ภายนอกกลุ่ม) · In-group (ในกลุ่ม) · Other
-- ไม่ใส่ข้อจำกัดค่าไว้ เพราะรายการอาจเพิ่มได้ในอนาคต และหน้าจอคุมให้อยู่แล้ว
--
-- รันซ้ำได้

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY['loans', 'leases', 'promissory_notes', 'floor_plans',
                           'overdrafts', 'trust_receipts', 'letters_of_credit',
                           'letter_guarantees', 'fx_forwards'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS rpt TEXT', v_table
      );
      EXECUTE format(
        'COMMENT ON COLUMN public.%I.rpt IS %L',
        v_table,
        'ประเภทคู่ค้าสำหรับลงบัญชี — External / In-group / Other'
      );
    END IF;
  END LOOP;
END $$;
