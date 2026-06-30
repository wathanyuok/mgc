-- 0055_ar_ap_netting.sql
-- Feature B8 — AR-AP Netting (Same Bank/Finance Institution)
--
-- Context (MoM workshop):
--   เมื่อ Customer A เป็น Vendor ที่สถาบันการเงินเดียวกันด้วย → สามารถ "netting"
--   ยอด AR-AP ก่อน จ่ายจริงเฉพาะส่วนต่าง · เฉพาะ Finance เดียวกันเท่านั้น
--
--   net_amount  = |ar − ap|
--   direction   = 'pay' (MGC จ่าย net)  หรือ  'receive' (MGC รับ net)
--
-- JE on execute (ตัวอย่าง — direction 'receive'):
--   Dr A/P (counterparty)   xx
--     Cr A/R (counterparty)   xx
--     Cr Bank (receive net)   yy   -- หรือ Dr Bank ถ้า direction='pay'

CREATE TABLE IF NOT EXISTS ar_ap_nettings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_no               TEXT UNIQUE NOT NULL,
  finance_institution      TEXT NOT NULL,                       -- 'KBANK' | 'BBL' | ... (consistent with existing facility tables)
  finance_institution_id   UUID,                                -- optional FK reserved (no FK constraint — no finance_institutions table yet)
  counterparty_vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  ar_amount                NUMERIC(18,2) NOT NULL,              -- what they owe us
  ap_amount                NUMERIC(18,2) NOT NULL,              -- what we owe them
  net_amount               NUMERIC(18,2) NOT NULL,              -- abs(ar - ap)
  direction                VARCHAR(10) NOT NULL,                -- 'pay' (MGC pays net) | 'receive' (MGC receives net)
  netting_date             DATE NOT NULL,
  status                   VARCHAR(20) NOT NULL DEFAULT 'Draft',-- Draft | Approved | Executed | Cancelled
  je_id                    UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  remark                   TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               TEXT
);

CREATE INDEX IF NOT EXISTS idx_ar_ap_nettings_status ON ar_ap_nettings(status);
CREATE INDEX IF NOT EXISTS idx_ar_ap_nettings_fi     ON ar_ap_nettings(finance_institution);
CREATE INDEX IF NOT EXISTS idx_ar_ap_nettings_vendor ON ar_ap_nettings(counterparty_vendor_id);
CREATE INDEX IF NOT EXISTS idx_ar_ap_nettings_date   ON ar_ap_nettings(netting_date);

-- RLS
ALTER TABLE ar_ap_nettings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_ar_ap_nettings" ON ar_ap_nettings;
CREATE POLICY "anon_all_ar_ap_nettings" ON ar_ap_nettings FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE ar_ap_nettings IS
  'Feature B8 — AR-AP Offset/Netting for counterparties that are both customer + vendor at the same finance institution. MoM workshop: "เฉพาะ Finance เดียวกัน".';
COMMENT ON COLUMN ar_ap_nettings.direction IS
  '''pay'' = MGC pays net (ap>ar) · ''receive'' = MGC receives net (ar>ap)';
COMMENT ON COLUMN ar_ap_nettings.status IS
  'Draft (entered) → Approved (signed off) → Executed (JE posted) | Cancelled';
