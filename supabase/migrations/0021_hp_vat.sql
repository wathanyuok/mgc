-- =====================================================================
--  HP (Hire Purchase) — VAT on installments + deferred interest schedule
--  Per MoM Day 4: VAT 7% คิดบนค่างวด (เงินต้น+ดอก) · Deferred Interest Balance
-- =====================================================================
alter table leases add column if not exists vat_rate numeric(5,2) not null default 7;

alter table lease_schedules add column if not exists vat                       numeric(18,2) not null default 0;
alter table lease_schedules add column if not exists total_inc_vat             numeric(18,2) not null default 0;
alter table lease_schedules add column if not exists deferred_interest_balance numeric(18,2) not null default 0;
alter table lease_schedules add column if not exists vat_balance               numeric(18,2) not null default 0;
