-- =====================================================================
--  Loan Prepayments — Full + Partial prepayment events (audit + re-amortize)
-- =====================================================================
create table if not exists loan_prepayments (
  id            uuid primary key default uuid_generate_v4(),
  loan_id       uuid not null references loans(id) on delete cascade,
  prepay_date   date not null,
  kind          text not null default 'Partial',   -- 'Full' | 'Partial'
  amount        numeric(18,2) not null default 0,   -- principal prepaid
  accrued_interest numeric(18,2) not null default 0,
  fee           numeric(18,2) not null default 0,
  fee_rate      numeric(7,4) not null default 0,
  fee_base      text,                                -- 'outstanding' | 'amount'
  reamortize_mode text default 'reduce-installment', -- 'reduce-installment' | 'reduce-term'
  total_paid    numeric(18,2) not null default 0,    -- cash out the door
  je_id         uuid references journal_entries(id) on delete set null,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_loan_prepay_loan on loan_prepayments(loan_id);
alter table loan_prepayments enable row level security;
drop policy if exists "anon_all_loan_prepayments" on loan_prepayments;
create policy "anon_all_loan_prepayments" on loan_prepayments for all using (true) with check (true);

-- closure metadata on loans
alter table loans add column if not exists closed_at   date;
alter table loans add column if not exists closed_reason text;
