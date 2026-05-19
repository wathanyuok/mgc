-- =====================================================================
--  TX add-ons: rate_cards (interest rate sub-table), acct_cards (accounting),
--  rollover_history tracking. Stored as JSONB for flexibility.
-- =====================================================================

alter table promissory_notes  add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table promissory_notes  add column if not exists acct_cards jsonb not null default '[]'::jsonb;
alter table promissory_notes  add column if not exists chassis_list jsonb not null default '[]'::jsonb;
alter table promissory_notes  add column if not exists rollover_parent_id uuid references promissory_notes(id) on delete set null;
alter table promissory_notes  add column if not exists accrued_interest numeric(18,2) not null default 0;
alter table promissory_notes  add column if not exists reference_transaction_id uuid references promissory_notes(id) on delete set null;

alter table floor_plans       add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table floor_plans       add column if not exists acct_cards jsonb not null default '[]'::jsonb;

alter table overdrafts        add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table overdrafts        add column if not exists acct_cards jsonb not null default '[]'::jsonb;

alter table trust_receipts    add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table trust_receipts    add column if not exists acct_cards jsonb not null default '[]'::jsonb;

alter table loans             add column if not exists rate_cards jsonb not null default '[]'::jsonb;
alter table loans             add column if not exists acct_cards jsonb not null default '[]'::jsonb;

alter table fx_forwards       add column if not exists acct_cards jsonb not null default '[]'::jsonb;
alter table letter_guarantees add column if not exists acct_cards jsonb not null default '[]'::jsonb;
