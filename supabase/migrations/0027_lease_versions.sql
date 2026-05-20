-- =====================================================================
--  Lease Version history — TFRS 16 Re-measurement (Lease Other)
--  Excel computes new ROU / Lease Liability after a modification;
--  the result is recorded here as a new version + an adjustment JE.
-- =====================================================================
create table if not exists lease_versions (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  version integer not null,
  effective_date date not null,
  rou_asset numeric not null default 0,
  lease_liability numeric not null default 0,
  annual_rate numeric,
  term_months integer,
  pl_amount numeric not null default 0,   -- Re-measurement Gain/(Loss); Dr (loss) positive
  reason text,
  je_id uuid references journal_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lease_versions_lease on lease_versions(lease_id);
