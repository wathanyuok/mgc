-- 0054_fx_valuation.sql
-- Feature B3 — FX Forward Monthly Mark-to-Market (Valuation) per MoM §13 #8
--
-- Context:
--   ณ สิ้นเดือน MGC ต้อง revalue FX Forward ที่ยัง Active ทั้งหมด เพื่อ post
--   Unrealized FX Gain/Loss เข้า GL (ตามมาตรฐาน TFRS 9 — derivative MTM)
--
--   MTM (THB) = notional_amount × (month_end_rate − contract_rate)
--   - notional_amount         = ปริมาณสกุล Foreign (USD/JPY/...)
--   - contract_rate           = forward_rate ใน fx_forwards (snapshot ตอน Active)
--   - month_end_rate          = spot rate ณ สิ้นเดือน (user paste / NetSuite daily feed)
--
--   ถ้า MTM > 0 → Unrealized FX Gain   (Dr FXF Asset / Cr Unrealized FX Gain)
--   ถ้า MTM < 0 → Unrealized FX Loss   (Dr Unrealized FX Loss / Cr FXF Liability)
--
-- One run per (fxf_id, valuation_date) — unique index.
-- JE link via source_type = 'FX_VALUATION', source_id = valuation.id

CREATE TABLE IF NOT EXISTS fx_valuations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fxf_id          UUID NOT NULL REFERENCES fx_forwards(id) ON DELETE CASCADE,
  valuation_date  DATE NOT NULL,
  month_end_rate  NUMERIC(12,4) NOT NULL,
  contract_rate   NUMERIC(12,4) NOT NULL,
  notional_amount NUMERIC(18,2) NOT NULL,
  notional_thb    NUMERIC(18,2) NOT NULL,
  mtm_thb         NUMERIC(18,2) NOT NULL,
  je_id           UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'Draft',  -- Draft | Posted | Reversed
  remark          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_valuations_fxf_date
  ON fx_valuations(fxf_id, valuation_date);

CREATE INDEX IF NOT EXISTS idx_fx_valuations_date
  ON fx_valuations(valuation_date);

CREATE INDEX IF NOT EXISTS idx_fx_valuations_status
  ON fx_valuations(status);

-- RLS
ALTER TABLE fx_valuations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_fx_valuations" ON fx_valuations;
CREATE POLICY "anon_all_fx_valuations" ON fx_valuations FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE fx_valuations IS
  'Feature B3 / MoM §13 #8 — Monthly Mark-to-Market valuation of active FX Forwards. One row per (FXF, month-end). JE source_type=FX_VALUATION.';
COMMENT ON COLUMN fx_valuations.mtm_thb IS
  '= notional_amount × (month_end_rate − contract_rate). Positive = Unrealized Gain, Negative = Unrealized Loss';
COMMENT ON COLUMN fx_valuations.status IS
  'Draft (computed, not posted) | Posted (JE created) | Reversed (typically next-period reversal)';
