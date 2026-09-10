-- COA: เพิ่มคอลัมน์ตามไฟล์ COA ล่าสุด (20260901)
--   account_category = Account Cathegory (ERP Required) — ประเภทบัญชีฝั่ง NetSuite
--   parent_code / parent_name = โครงบัญชีแม่-ลูก
-- ข้อมูลจริง re-import ผ่าน coa_reimport_20260901.sql (รันใน SQL Editor)

ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS account_category text;
ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS parent_code text;
ALTER TABLE gl_accounts ADD COLUMN IF NOT EXISTS parent_name text;

CREATE INDEX IF NOT EXISTS idx_gl_accounts_category ON gl_accounts (account_category);
