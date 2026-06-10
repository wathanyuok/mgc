-- NetSuite Sync Log — audit trail for every JE sync attempt to NetSuite
-- Used by /je/sync-log page + Excel Export for Auditor

CREATE TABLE IF NOT EXISTS netsuite_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  je_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
  je_number VARCHAR(40) NOT NULL,
  sync_method VARCHAR(10) NOT NULL DEFAULT 'stub',  -- 'api' | 'file' | 'stub'
  triggered_by TEXT,                                  -- user identifier
  request_payload JSONB,                              -- full payload sent
  response_status INTEGER,                            -- HTTP status code
  response_body JSONB,                                -- NetSuite response
  netsuite_je_id VARCHAR(80),                         -- NetSuite's internal ID returned
  sync_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'success' | 'failed' | 'pending'
  error_message TEXT,
  duration_ms INTEGER,                                -- request latency
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_netsuite_sync_log_je_id ON netsuite_sync_log(je_id);
CREATE INDEX IF NOT EXISTS idx_netsuite_sync_log_created ON netsuite_sync_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_netsuite_sync_log_status ON netsuite_sync_log(sync_status);

COMMENT ON TABLE netsuite_sync_log IS 'Audit trail for every NetSuite GL sync attempt. Auditor uses Export Excel from /je/sync-log page.';
COMMENT ON COLUMN netsuite_sync_log.sync_method IS 'How the sync was performed: api=real REST call, file=CSV export, stub=mock (dev)';
COMMENT ON COLUMN netsuite_sync_log.sync_status IS 'Outcome: success/failed/pending';
