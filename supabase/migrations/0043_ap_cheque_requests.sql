-- AP Cheque Requests — track lifecycle of cheque requests sent to NetSuite AP Module
-- Per MoM_MGC_LoanLease_NetSuite §3.2: "เมื่อต้องออกเช็ค จึงต้องส่งข้อมูลไปให้ AP เพื่อตั้ง request ออกเช็ค"

CREATE TABLE IF NOT EXISTS ap_cheque_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source linkage
  source_type VARCHAR(30) NOT NULL,        -- 'REPAYMENT' | 'LEASE_PAYMENT' | 'LOAN_INTEREST'
  source_id UUID NOT NULL,                  -- FK to repayments / leases / loans
  repayment_id UUID REFERENCES repayments(id) ON DELETE SET NULL,

  -- Cheque details
  vendor_name VARCHAR(120),                 -- e.g. KBANK, BBL (Finance Institution)
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'THB',
  due_date DATE,
  memo TEXT,

  -- GL reference (already posted in JE)
  je_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  gl_account VARCHAR(20),                   -- e.g. 2110000 AP

  -- Cheque lifecycle
  cheque_no VARCHAR(20),                    -- ออกแล้วถึงจะมี
  issued_date DATE,
  cleared_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending | Approved | Issued | Cleared | Cancelled

  -- NetSuite AP integration (รอ Template — เก็บ placeholder)
  netsuite_ap_id VARCHAR(80),
  netsuite_payload JSONB,
  netsuite_response JSONB,
  sync_status VARCHAR(20),                  -- pending | synced | failed
  sync_error TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_ap_cheque_status ON ap_cheque_requests(status);
CREATE INDEX IF NOT EXISTS idx_ap_cheque_source ON ap_cheque_requests(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ap_cheque_repayment ON ap_cheque_requests(repayment_id);
CREATE INDEX IF NOT EXISTS idx_ap_cheque_due ON ap_cheque_requests(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_cheque_no ON ap_cheque_requests(cheque_no);

COMMENT ON TABLE ap_cheque_requests IS 'Cheque requests for AP Module of NetSuite. Per MoM_NetSuite §3.2. Used by /tx/repayments tab AP Cheques.';
COMMENT ON COLUMN ap_cheque_requests.status IS 'Lifecycle: Pending (created) → Approved → Issued (cheque cut) → Cleared (bank cleared) | Cancelled';
COMMENT ON COLUMN ap_cheque_requests.sync_status IS 'NetSuite AP sync state (rec to NetSuite AP module). Awaiting AP Template spec.';
