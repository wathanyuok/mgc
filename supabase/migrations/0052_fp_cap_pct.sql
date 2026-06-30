-- 0052_fp_cap_pct.sql
-- Floor Plan A6 — 80% cap per chassis (MoM §12.1)
-- Source: MoM_Loan_Lease_Workshop Day 4 §12.1 +
--   "เบิกได้ไม่เกิน 80% ของมูลค่ารถ ต่อคัน · config 100% ได้ ·
--    ถ้ารวมเกินวงเงิน → user ปรับเอง"
--
-- Schema changes:
--   • floor_plans.cap_pct       — per-FP cap (default 80%, configurable 50-100%)
--   • fp_chassis.chassis_price  — snapshot of chassis cost at pickup time
--     (protects existing FPs from later cost-master changes; cap is computed
--      against the snapshot, not the live NetSuite cost)
--
-- Backwards compat: existing fp_chassis rows seed chassis_price = amount so
-- the cap is satisfied for pre-existing data (one-time backfill).

-- ── floor_plans.cap_pct ──
ALTER TABLE floor_plans
  ADD COLUMN IF NOT EXISTS cap_pct numeric(5,2) NOT NULL DEFAULT 80.00;

COMMENT ON COLUMN floor_plans.cap_pct IS
  'MoM §12.1 — เพดานเบิกต่อรถ (% ของราคารถ). Default 80%, config ได้ 50-100%.';

-- ── fp_chassis.chassis_price ──
ALTER TABLE fp_chassis
  ADD COLUMN IF NOT EXISTS chassis_price numeric(18,2);

COMMENT ON COLUMN fp_chassis.chassis_price IS
  'Snapshot ของ chassis cost ตอน Lookup (จาก NetSuite). ใช้เป็นฐานคำนวณ cap_pct — ป้องกัน cost แม่ค้าเปลี่ยนทีหลังแล้วทำให้ FP เก่าหลุด cap.';

-- ── one-time backfill: chassis_price = amount for existing rows ──
UPDATE fp_chassis
   SET chassis_price = amount
 WHERE chassis_price IS NULL;
