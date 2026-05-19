-- =====================================================================
--  Bank Statement Master — shared across O/D (and future TX types)
--  Header: bank_statements (one row per uploaded statement / period)
--  Lines:  bank_statement_lines (individual transactions)
-- =====================================================================

create table if not exists bank_statements (
  id                   uuid primary key default uuid_generate_v4(),
  finance_institution  text not null,                -- KBANK / SCB / BBL / KTB / BAY
  account_no           text not null,                -- e.g. 1403024625
  statement_name       text,                          -- e.g. "SCB Sep 2024 Statement"
  statement_period     text,                          -- e.g. "2024-09"
  source               text not null default 'Manual', -- Manual / Import
  inactive             boolean not null default false,
  remark               text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_bank_stmt_inst on bank_statements(finance_institution);
create index if not exists idx_bank_stmt_acct on bank_statements(account_no);

create table if not exists bank_statement_lines (
  id                   uuid primary key default uuid_generate_v4(),
  statement_id         uuid not null references bank_statements(id) on delete cascade,
  tx_date              date not null,
  tx_time              text,                          -- "12:30"
  txn_code             text,                          -- FE / ENET / TRANSFER
  description          text,
  debit                numeric(18,2) not null default 0,
  credit               numeric(18,2) not null default 0,
  balance              numeric(18,2) not null default 0,   -- running balance (can be negative)
  source               text not null default 'Manual',     -- Manual / Import
  remark               text,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);
create index if not exists idx_bank_line_stmt on bank_statement_lines(statement_id, tx_date);
create index if not exists idx_bank_line_date on bank_statement_lines(tx_date);

-- RLS
alter table bank_statements enable row level security;
alter table bank_statement_lines enable row level security;
drop policy if exists "anon_all_bank_stmt" on bank_statements;
drop policy if exists "anon_all_bank_lines" on bank_statement_lines;
create policy "anon_all_bank_stmt" on bank_statements for all using (true) with check (true);
create policy "anon_all_bank_lines" on bank_statement_lines for all using (true) with check (true);

-- Triggers
create trigger trg_bank_stmt_updated before update on bank_statements
  for each row execute function set_updated_at();
