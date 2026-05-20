-- =====================================================================
--  Repayment — multi-contract allocation lines (per MoM: แยกประเภท + หลายสัญญา)
--  Each repayment can pay several contracts, split by category
--  (Principal / Interest / Fee / Penalty), then post one JE.
-- =====================================================================

-- header extensions
alter table repayments add column if not exists penalty   numeric(18,2) not null default 0;
alter table repayments add column if not exists je_id     uuid references journal_entries(id) on delete set null;

create table if not exists repayment_lines (
  id             uuid primary key default uuid_generate_v4(),
  repayment_id   uuid not null references repayments(id) on delete cascade,
  facility_type  text not null,
  facility_id    uuid,
  contract_label text,
  category       text not null default 'Interest',  -- Principal | Interest | Fee | Penalty
  amount         numeric(18,2) not null default 0,
  sort_order     int not null default 0
);
create index if not exists idx_rp_lines_rep on repayment_lines(repayment_id);
alter table repayment_lines enable row level security;
drop policy if exists "anon_all_repayment_lines" on repayment_lines;
create policy "anon_all_repayment_lines" on repayment_lines for all using (true) with check (true);
