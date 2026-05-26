-- =====================================================================
--  L/C — add Pay & Close settlement fields (MoM Day3 §7 path A)
--  Aligns LC with LG/BG/FP "Close" action: direct-pay from bank →
--  status: Active → Closed; posts Settlement JE (reverse off-balance,
--  clear bank payable, FX revaluation at settlement date).
-- =====================================================================

ALTER TABLE letters_of_credit
  ADD COLUMN IF NOT EXISTS settlement_date     DATE,
  ADD COLUMN IF NOT EXISTS settlement_amount   NUMERIC(20, 2),   -- THB paid = foreign × settlement_fx_rate
  ADD COLUMN IF NOT EXISTS settlement_fx_rate  NUMERIC(20, 8),   -- FX on settle date (≠ issue date rate)
  ADD COLUMN IF NOT EXISTS closed_date         DATE;

COMMENT ON COLUMN letters_of_credit.settlement_date    IS 'Date money was paid direct from bank (Pay & Close path)';
COMMENT ON COLUMN letters_of_credit.settlement_amount  IS 'THB equivalent actually paid (revalued at settlement_fx_rate)';
COMMENT ON COLUMN letters_of_credit.settlement_fx_rate IS 'FX rate on settlement date — used for FX gain/loss vs issue rate';
COMMENT ON COLUMN letters_of_credit.closed_date        IS 'Final close date — set by Pay & Close action';
