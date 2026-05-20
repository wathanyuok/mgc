-- =====================================================================
--  Lease/HP — Roll Over chain (balloon → new contract)
-- =====================================================================
alter table leases add column if not exists rollover_parent_id uuid references leases(id) on delete set null;
