-- =====================================================================
--  Phase 3 (stub): NetSuite Sync columns on journal_entries
-- =====================================================================

alter table journal_entries add column if not exists netsuite_je_id    text;
alter table journal_entries add column if not exists netsuite_synced_at timestamptz;
alter table journal_entries add column if not exists sync_status        text;   -- pending / synced / failed

create index if not exists idx_je_sync_status on journal_entries(sync_status);
