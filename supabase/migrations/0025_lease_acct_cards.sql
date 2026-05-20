-- =====================================================================
--  Lease/HP — Accounting cards (account type → GL) like other TX modules
-- =====================================================================
alter table leases add column if not exists acct_cards jsonb not null default '[]'::jsonb;
