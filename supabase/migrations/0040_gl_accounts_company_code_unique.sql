-- =====================================================================
-- 0040_gl_accounts_company_code_unique.sql
-- Purpose: Enforce BR-MST-COA-001 — Account code ต้องไม่ซ้ำในบริษัทเดียวกัน
-- Reference: BR-MST-COA-001 (Bank Statement Master rules)
--
-- Behavior:
--   • (company, code) เป็น composite UNIQUE
--   • COALESCE(company, '') กัน NULL company คือ "ทั่วทุกบริษัท" → ก็ unique กับตัวเอง
--   • Use IF NOT EXISTS for idempotency (safe to re-run)
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_accounts_company_code
ON gl_accounts (COALESCE(company, ''), code);

COMMENT ON INDEX uq_gl_accounts_company_code IS
  'Prevent duplicate (company, code) per BR-MST-COA-001 — same code allowed across companies, blocked within same company';
