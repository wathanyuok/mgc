-- =====================================================================
--  Lease/HP — additional contract fields to match HTML form (MoM Day 4)
-- =====================================================================
alter table leases add column if not exists contract_number    text;
alter table leases add column if not exists contract_date       date;
alter table leases add column if not exists classification      text default 'Finance';   -- Finance | Operating
alter table leases add column if not exists payment_frequency   text default 'Monthly';
alter table leases add column if not exists payment_start_date  date;
alter table leases add column if not exists end_date            date;
alter table leases add column if not exists payment_type        text default 'Fix Installment';
