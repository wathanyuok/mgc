-- 0045_repayment_bank_line_link.sql
-- Link Repayment back to the Bank Statement Line that funded it.
-- Per Gap audit (MoM §4 — Loan Payment methods): Bank Statement Import → Repayment
-- workflow needs traceability so accountant + auditor can pivot between the bank
-- evidence (statement line) and the accounting record (repayment + JE).
--
-- Optional FK — repayments created via Manual / CSV Import / AP Cheque keep this NULL.

ALTER TABLE repayments
  ADD COLUMN IF NOT EXISTS bank_statement_line_id UUID
    REFERENCES bank_statement_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repayments_bank_line
  ON repayments(bank_statement_line_id)
  WHERE bank_statement_line_id IS NOT NULL;

COMMENT ON COLUMN repayments.bank_statement_line_id IS
  'FK to bank_statement_lines.id when Repayment was created from a Bank Statement line (Source = Bank). NULL = Manual / CSV Import / AP Cheque / other source.';
