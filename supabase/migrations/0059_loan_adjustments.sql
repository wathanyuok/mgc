-- 0059_loan_adjustments.sql
-- Feature C3 — Loan T+2 Reconcile + Manual Adjust workflow
--
-- Workshop guidance (3.txt §3-75):
--   Loan ต้องรอ Bank Statement (T+2) จึงจะรู้ยอดตัดจริง.
--   แบงก์บางที่คิดดอกเบี้ยถึงวันตัด (ยอดตรง) · บางที่คิดถึงก่อนหน้า 1 วัน (BBL) —
--   ทำให้แบ่ง principal/interest ไม่ตรง schedule.
--   นอกจากนี้ อัตราดอกเบี้ยลอยตัวเปลี่ยนระหว่างงวดก็ทำให้ยอดผิดได้อีก.
--
--   บัญชีจึงต้อง "manual adjust" — เอายอดจาก Bank Statement เป็น total,
--   แล้วผู้ใช้ระบุ split ใหม่ระหว่าง principal/interest, พร้อม reason
--   (rate_change · day_diff · bank_overcut · other) และ optionally
--   flag ว่าแบงก์ตัดเกิน (รอรับเงินคืนจากแบงก์).
--
--   JE reallocation:
--     ถ้า new_principal > original_principal → Dr Loan Interest / Cr Loan Principal (ลด interest, เพิ่ม principal)
--     ถ้า new_principal < original_principal → Dr Loan Principal / Cr Loan Interest (กลับด้าน)

CREATE TABLE IF NOT EXISTS loan_adjustments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id                     UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  period                      INTEGER NOT NULL,                    -- schedule period_no
  bank_statement_line_id      UUID,                                -- optional link (soft FK)
  -- Original (from loan_schedules snapshot)
  original_principal          NUMERIC(18,2) NOT NULL,
  original_interest           NUMERIC(18,2) NOT NULL,
  original_total              NUMERIC(18,2) NOT NULL,
  -- Adjusted values (user input)
  adjusted_principal          NUMERIC(18,2) NOT NULL,
  adjusted_interest           NUMERIC(18,2) NOT NULL,
  adjusted_total              NUMERIC(18,2) NOT NULL,
  -- Optional bank over-cut flag → tracks refund owed by bank
  refund_pending              BOOLEAN NOT NULL DEFAULT FALSE,
  refund_amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
  refund_received_date        DATE,
  -- Reason for the adjustment
  reason                      VARCHAR(20) NOT NULL DEFAULT 'other',
  notes                       TEXT,
  je_id                       UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  status                      VARCHAR(20) NOT NULL DEFAULT 'Posted',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_loan_adjustments_loan
  ON loan_adjustments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_adjustments_period
  ON loan_adjustments(loan_id, period);
CREATE INDEX IF NOT EXISTS idx_loan_adjustments_bank_line
  ON loan_adjustments(bank_statement_line_id);
CREATE INDEX IF NOT EXISTS idx_loan_adjustments_refund
  ON loan_adjustments(refund_pending) WHERE refund_pending = TRUE;

-- RLS
ALTER TABLE loan_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_loan_adjustments" ON loan_adjustments;
CREATE POLICY "anon_all_loan_adjustments" ON loan_adjustments
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE loan_adjustments IS
  'C3 — Manual reconciliation adjustments per Loan period. Records the reallocation of principal/interest when bank cut differs from schedule (rate change, day diff, bank over-cut). One row per adjustment action.';
COMMENT ON COLUMN loan_adjustments.reason IS
  'rate_change | day_diff | bank_overcut | other';
COMMENT ON COLUMN loan_adjustments.refund_pending IS
  'TRUE when bank over-cut — tracks refund owed. Cleared when refund_received_date is filled.';
COMMENT ON COLUMN loan_adjustments.je_id IS
  'Reallocation JE (source_type=LOAN_ADJUST) that moves value between Interest Income and Principal Receivable.';
