-- =====================================================================
--  Letter of Credit (L/C) module — MoM Day3 §7 (action item #6)
--  ปัจจุบัน LC อยู่ใต้ LG/BG (Off-Balance / Contingent) — แยกออกมาเป็น module
--  เพื่อรองรับ Flow LC → TR (นำเข้ารถจากจีน)
--    - LC = Off-Balance, Short Term (2–3 เดือน), ไม่คิดดอกเบี้ย
--    - Fee 2 แบบ: (1) Full-term % (เช่น 1.48% ตลอดเทอม)
--                 (2) Engagement Fee + Pro-rated ตามวันใช้จริง
--    - Flow LC → TR: สินค้ามาถึง → เปิด TR → เริ่มคิดดอกเบี้ย (On-Balance)
--    - SBLC (Standby LC) ใช้ร่วมวงเงิน LC
--    - Reference FX Forward ที่ Hedge ไว้ (partial use)
-- =====================================================================

create type lc_status as enum ('Draft', 'Approved', 'Active', 'Converted', 'Expired', 'Closed');

create table if not exists letters_of_credit (
  id                 uuid primary key default gen_random_uuid(),
  lc_no              text not null,
  name               text,
  ca_id              uuid references credit_agreements(id) on delete set null,
  finance_institution text not null default '',
  lc_type            text not null default 'LC',     -- 'LC' | 'SBLC' (Standby)
  beneficiary        text,                            -- ผู้รับผลประโยชน์ (vendor/supplier)
  applicant          text,                            -- ผู้ขอเปิด (MGC)
  -- amounts (multi-currency)
  currency           text not null default 'USD',
  amount_foreign     numeric(18,2) not null default 0,
  conversion_rate    numeric(12,6),                   -- FX rate → THB
  amount             numeric(18,2) not null default 0, -- THB equivalent
  -- dates
  issue_date         date,
  expiry_date        date,
  transaction_date   date,
  term_days          integer,
  -- fee structure (LC ไม่มีดอกเบี้ย คิดเป็น fee)
  fee_mode           text not null default 'full_term', -- 'full_term' | 'engagement_prorated'
  fee_rate           numeric(8,4) not null default 0,   -- % เช่น 1.48
  engagement_fee     numeric(18,2) not null default 0,  -- ค่าธรรมเนียมแรกเข้า (mode 2)
  fee_amount         numeric(18,2) not null default 0,  -- คำนวณ/บันทึก
  -- references
  reference_fxf_id   uuid references fx_forwards(id) on delete set null, -- Hedge ที่อ้างอิง
  reference_contract text,
  shared_limit_with_tr boolean not null default true,   -- LC+TR แชร์วงเงิน
  -- conversion → TR
  converted_tr_id    uuid references trust_receipts(id) on delete set null,
  conversion_date    date,
  inactive           boolean not null default false,
  status             lc_status not null default 'Draft',
  remark             text,
  rate_cards         jsonb not null default '[]'::jsonb,
  acct_cards         jsonb not null default '[]'::jsonb,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_lc_ca on letters_of_credit(ca_id);

alter table letters_of_credit enable row level security;
do $$ begin
  create policy anon_all_lc on letters_of_credit for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Link from TR back to the originating LC (Flow LC → TR).
alter table trust_receipts add column if not exists source_lc_id uuid references letters_of_credit(id) on delete set null;

-- ── lc_documents + storage bucket (B/L, invoice, shipping docs) ──
create table if not exists lc_documents (
  id            uuid primary key default gen_random_uuid(),
  lc_id         uuid not null references letters_of_credit(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_lc_doc_lc on lc_documents(lc_id);

alter table lc_documents enable row level security;
do $$ begin
  create policy anon_all_lc_documents on lc_documents for all using (true) with check (true);
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public)
values ('lc-documents', 'lc-documents', true)
on conflict (id) do nothing;

do $$ begin
  create policy anon_all_lc_docs on storage.objects
    for all using (bucket_id = 'lc-documents') with check (bucket_id = 'lc-documents');
exception when duplicate_object then null; end $$;
