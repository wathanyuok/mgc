-- =====================================================================
--  Lease/HP — add 'Approved' + 'Roll Over' to lease_status enum
--  Aligns Lease lifecycle with other modules: Draft → Approved → Active
--  ('Roll Over' was used in code but missing from the enum.)
-- =====================================================================

ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'Roll Over';
