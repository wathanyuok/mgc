-- 0057_fa_transfer.sql
-- Feature B6 — Fixed Asset transfer (Option A: Suspense → Asset)
--
-- Workshop guidance (3.txt §575-580):
--   MGC chose Option A: ตอน drawdown → ลงบัญชีพักก่อน ·
--   พอรับรถเข้าจริง → user กดโอนเข้า Fixed Asset
--
-- Schema additions:
--   • fa_transfers — log table; one row per "asset received → posted FA JE" action.
--     Polymorphic FK pattern (facility_type + facility_id) ตาม style ของ bank_statement_lines.

CREATE TABLE IF NOT EXISTS fa_transfers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_type      VARCHAR(20) NOT NULL,            -- 'floor_plan' | 'lease' (HP)
  facility_id        UUID NOT NULL,                   -- app-side validated (no DB FK due to polymorphism)
  chassis_id         UUID,                            -- optional — when transfer is per-chassis
  chassis_no         VARCHAR(40),                     -- snapshot (kept even if chassis row deleted)
  transferred_amount NUMERIC(18,2) NOT NULL,          -- amount moved out of suspense
  transfer_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status             VARCHAR(20) NOT NULL DEFAULT 'Posted',  -- Posted | Reversed
  je_id              UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  remark             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_fa_transfers_facility
  ON fa_transfers(facility_type, facility_id);
CREATE INDEX IF NOT EXISTS idx_fa_transfers_date
  ON fa_transfers(transfer_date);

-- RLS
ALTER TABLE fa_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_fa_transfers" ON fa_transfers;
CREATE POLICY "anon_all_fa_transfers" ON fa_transfers FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE fa_transfers IS
  'Feature B6 — Fixed Asset transfer log (suspense → asset). Polymorphic FK to facility (floor_plans/leases). JE source_type=FA_TRANSFER.';
COMMENT ON COLUMN fa_transfers.facility_type IS
  'floor_plan | lease (HP mode). Determines target facility table for the linked drawdown.';
COMMENT ON COLUMN fa_transfers.transferred_amount IS
  'Amount that moves out of suspense — Dr Vehicle Asset / Cr Vehicle Suspense.';
