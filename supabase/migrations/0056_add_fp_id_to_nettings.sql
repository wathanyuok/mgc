-- 0056_add_fp_id_to_nettings.sql
-- Feature B8 refactor — couple AR-AP Netting to a specific Floor Plan facility.
--
-- Context (MoM workshop transcript Day 4 §lines 85-100):
--   Netting ผูกตรงกับ Floor Plan payment scenarios — ไม่ใช่ generic AR-AP feature
--   UI ย้ายจากหน้า standalone (/tx/netting) ไปเป็น Tab ใต้ Floor Plan
--
-- Schema changes:
--   • ar_ap_nettings.fp_id — nullable FK to floor_plans (parent FP context).
--     nullable เพื่อ backward-compat กับ rows เดิมที่สร้างก่อน refactor.

ALTER TABLE ar_ap_nettings
  ADD COLUMN IF NOT EXISTS fp_id UUID REFERENCES floor_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ar_ap_nettings_fp ON ar_ap_nettings(fp_id);

COMMENT ON COLUMN ar_ap_nettings.fp_id IS
  'Floor Plan ที่ Netting นี้ผูกอยู่ · nullable สำหรับ rows ก่อน refactor (B8 → FP Tab)';
