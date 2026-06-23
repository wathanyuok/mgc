-- 0047_payment_type.sql
-- 2-Level Channel + Payment Type refactor (per MoM Interface §3.2, §4)
-- Before: CHANNELS = ['Bank Statement', 'AP Module', 'Cash', 'Cheque']
-- After:  CHANNELS = ['Bank Statement', 'AP', 'Cash']
--         PAYMENT_TYPES = ['Cheque']  (Phase 1 — Wire/EFT/CreditCard เพิ่มใน Phase 2)
--
-- Rationale: MoM Interface §3.2 + §4 ระบุชัด — เช็คทุกใบต้องส่ง AP NetSuite
--   ไม่มี "Cheque manual" path ที่ทำให้ระบบขัด MoM
-- This migration consolidates 'AP Module' + 'Cheque' channels → single 'AP' channel
-- with payment_type field (Phase 1 only Cheque, easy to extend to Wire/EFT in Phase 2)

ALTER TABLE repayments
  ADD COLUMN IF NOT EXISTS payment_type TEXT
    CHECK (payment_type IN ('Cheque', 'Wire', 'EFT', 'CreditCard'));

-- Backfill legacy data:
--   channel='AP Module' (NetSuite cheque)    → channel='AP', payment_type='Cheque'
--   channel='Cheque' (was "manual" but MoM doesn't support) → channel='AP', payment_type='Cheque'
UPDATE repayments
  SET payment_type = 'Cheque',
      channel = 'AP'
  WHERE channel IN ('AP Module', 'Cheque')
    AND payment_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_repayments_channel_paytype
  ON repayments(channel, payment_type)
  WHERE channel = 'AP';

COMMENT ON COLUMN repayments.payment_type IS
  'Payment method when channel = AP (Phase 1: Cheque only · Phase 2: Wire/EFT/CreditCard). NULL when channel != AP.';
