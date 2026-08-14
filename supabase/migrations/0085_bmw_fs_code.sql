-- 0085: แปลงข้อมูลเดิม 'BMW Financial Services' → ชื่อย่อ 'BMW-FS'
-- (dropdown เปลี่ยนมาดึงชื่อย่อจาก Vendor Master แล้ว — ข้อมูลเก่าต้องตามให้ตรง)
-- Idempotent — รันซ้ำได้ · ไล่ update ทุกตารางที่มีคอลัมน์ finance_institution อัตโนมัติ

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOR v_table IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'finance_institution'
  LOOP
    EXECUTE format(
      'UPDATE %I SET finance_institution = ''BMW-FS'' WHERE finance_institution = ''BMW Financial Services''',
      v_table
    );
  END LOOP;
END $$;
