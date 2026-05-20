-- =====================================================================
--  Lease/HP — payment option flags (match HTML form)
-- =====================================================================
alter table leases add column if not exists calc_interest_end           boolean not null default false;
alter table leases add column if not exists include_balloon_installment boolean not null default true;
alter table leases add column if not exists pay_eom                      boolean not null default true;
