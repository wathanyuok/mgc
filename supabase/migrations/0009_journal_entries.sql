-- =====================================================================
--  Phase 2: Journal Entries — production-grade GL postings
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- journal_entries (header)
-- ---------------------------------------------------------------------
create table if not exists journal_entries (
  id                 uuid primary key default uuid_generate_v4(),
  je_number          text not null unique,                            -- JE-2024-00001
  source_type        text not null,                                   -- LG_FEE / PN_INT / LEASE_PAY / MANUAL / ...
  source_id          uuid,                                            -- FK soft-link to source TX
  source_period      int,                                             -- which schedule period
  je_date            date not null,
  posting_period     text,                                            -- "Oct 2024"
  description        text,
  total_dr           numeric(18, 2) not null default 0,
  total_cr           numeric(18, 2) not null default 0,
  status             text not null default 'Draft'
                       check (status in ('Draft', 'Posted', 'Reversed', 'Voided')),
  posted_by          text,
  posted_at          timestamptz,
  reversed_by_je_id  uuid references journal_entries(id) on delete set null,
  is_reversal        boolean not null default false,                  -- this JE reverses another
  remark             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_je_source on journal_entries(source_type, source_id);
create index if not exists idx_je_date   on journal_entries(je_date);
create index if not exists idx_je_status on journal_entries(status);

-- ---------------------------------------------------------------------
-- je_lines (detail)
-- ---------------------------------------------------------------------
create table if not exists je_lines (
  id            uuid primary key default uuid_generate_v4(),
  je_id         uuid not null references journal_entries(id) on delete cascade,
  line_no       int not null,
  account_code  text,
  account_name  text,
  dr            numeric(18, 2) not null default 0,
  cr            numeric(18, 2) not null default 0,
  description   text,
  unique (je_id, line_no)
);
create index if not exists idx_jel_je on je_lines(je_id);

-- ---------------------------------------------------------------------
-- Auto-generate JE number (per year, zero-padded)
-- ---------------------------------------------------------------------
create or replace function next_je_number()
returns text language plpgsql as $$
declare
  yr text := to_char(now(), 'YYYY');
  n  int;
begin
  select coalesce(max(substring(je_number from 9)::int), 0) + 1 into n
  from journal_entries
  where je_number like 'JE-' || yr || '-%';
  return 'JE-' || yr || '-' || lpad(n::text, 5, '0');
end $$;

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create trigger trg_je_updated before update on journal_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table journal_entries enable row level security;
alter table je_lines        enable row level security;
drop policy if exists "anon_all_je"  on journal_entries;
drop policy if exists "anon_all_jel" on je_lines;
create policy "anon_all_je"  on journal_entries for all using (true) with check (true);
create policy "anon_all_jel" on je_lines        for all using (true) with check (true);
