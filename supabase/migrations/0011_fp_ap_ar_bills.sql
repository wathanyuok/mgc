-- =====================================================================
--  Floor Plan AP / AR Bill sub-tables
--  AP Bill = invoices payable to vendor (BMW Thailand)
--  AR Bill = invoices receivable from customer (when chassis is sold)
-- =====================================================================

create table if not exists fp_ap_bills (
  id              uuid primary key default uuid_generate_v4(),
  fp_id           uuid not null references floor_plans(id) on delete cascade,
  invoice_no      text not null,
  vendor_name     text,
  inventory_amount numeric(18,2) not null default 0,
  ap_amount       numeric(18,2) not null default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fp_ap_fp on fp_ap_bills(fp_id);

alter table fp_ap_bills enable row level security;
drop policy if exists "anon_all_fp_ap_bills" on fp_ap_bills;
create policy "anon_all_fp_ap_bills" on fp_ap_bills for all using (true) with check (true);

create table if not exists fp_ar_bills (
  id              uuid primary key default uuid_generate_v4(),
  fp_id           uuid not null references floor_plans(id) on delete cascade,
  ar_invoice_no   text not null,
  customer_name   text,
  ar_amount       numeric(18,2) not null default 0,
  status          text default 'Pending',           -- Pending / Paid / Cancelled
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fp_ar_fp on fp_ar_bills(fp_id);

alter table fp_ar_bills enable row level security;
drop policy if exists "anon_all_fp_ar_bills" on fp_ar_bills;
create policy "anon_all_fp_ar_bills" on fp_ar_bills for all using (true) with check (true);
