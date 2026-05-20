-- =====================================================================
--  Loan — Grace Period (months) for "Grace Period and ..." payment types
-- =====================================================================
alter table loans add column if not exists grace_months int not null default 0;
