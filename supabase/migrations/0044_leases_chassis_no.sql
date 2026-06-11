-- Add chassis_no column to leases (HP mode) — per BR-LEASE-026 Chassis Exclusive Rule
-- Enables checkChassisConflict() to query directly without ilike asset_name

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS chassis_no VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_leases_chassis_no ON leases(chassis_no);

COMMENT ON COLUMN leases.chassis_no IS 'NetSuite Chassis No (HP mode only). Populated from Chassis Lookup. Used by BR-LEASE-026 conflict check across HP/Loan/FP/PN.';
