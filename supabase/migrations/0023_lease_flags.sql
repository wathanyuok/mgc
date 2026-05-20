-- =====================================================================
--  Lease/HP — control flags (match HTML form checkboxes)
-- =====================================================================
alter table leases add column if not exists posting_lease    boolean not null default true;
alter table leases add column if not exists jv_auto_approve   boolean not null default false;
alter table leases add column if not exists inactive          boolean not null default false;
