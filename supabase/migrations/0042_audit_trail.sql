-- Audit Trail — track key user actions across all modules
-- Used by /audit-trail page + Excel Export for Auditor

CREATE TABLE IF NOT EXISTS audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                          -- Supabase auth user id (nullable for system events)
  user_email TEXT,                       -- denormalized for quick filter/export
  action VARCHAR(40) NOT NULL,           -- 'create' | 'update' | 'delete' | 'post_je' | 'reverse_je' | 'sync_netsuite' | etc.
  table_name VARCHAR(60) NOT NULL,       -- which module/table affected
  record_id TEXT,                        -- id of the affected record
  record_label TEXT,                     -- human-readable identifier (e.g. LN-2026-001)
  summary TEXT,                          -- short description of what happened
  before_data JSONB,                     -- optional snapshot before change
  after_data JSONB,                      -- optional snapshot after change
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_table ON audit_trail(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_trail_user ON audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_record ON audit_trail(table_name, record_id);

COMMENT ON TABLE audit_trail IS 'User action audit trail (Create/Update/Delete/Post/Reverse/Sync). Auditor uses Export Excel from /audit-trail.';
COMMENT ON COLUMN audit_trail.action IS 'Action type: create/update/delete/post_je/reverse_je/void_je/sync_netsuite/approve/etc';
COMMENT ON COLUMN audit_trail.record_label IS 'Human-readable identifier (e.g. LN-2026-001, JE-2026-00042)';
