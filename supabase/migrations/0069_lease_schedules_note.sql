-- =====================================================================
-- Migration 0069 — Add `note` column to lease_schedules
-- =====================================================================
-- Frontend code writes lease_schedules.note (Prepaid / Grace / Balloon flags)
-- but DBML/schema was missing the column. This aligns the actual DB with
-- what the code writes.
--
-- Applied fields:
--   note (Leasing only): "Prepaid" · "Grace" · "Balloon" · "Prepaid + Balloon"
--   HP does not use this column · will be NULL for HP rows.
--
-- Also documented (no schema change):
--   principal_undiscounted = Σ payments − Accum. Interest (computed at display · not stored)
-- =====================================================================

BEGIN;

ALTER TABLE lease_schedules ADD COLUMN IF NOT EXISTS note varchar(40);

COMMENT ON COLUMN lease_schedules.note IS
  'Leasing only · flag งวดพิเศษ: Prepaid (จ่ายล่วงหน้า Day 1) · Grace (จ่ายเฉพาะดอก · ไม่ตัดต้น) · Balloon (งวดสุดท้ายมี Balloon) · Prepaid + Balloon · HP mode: always NULL';

COMMIT;

-- =====================================================================
-- Verify:
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'lease_schedules' AND column_name = 'note';
-- =====================================================================
