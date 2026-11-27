-- =====================================================================
-- 0114 — L/C ผูก FX ได้หลายรายการ (ตาม MoM 30Sep2026 #8)
--   "ในหนึ่ง LC มี FX ได้มากกว่าหนึ่งตัว" (บรรทัด 2211)
--   ตัวแม่ผูกชุด FX ได้หลายตัว · ตัวลูก (sub-LC) เลือก FX ได้เฉพาะจากชุดของตัวแม่ (บรรทัด 1509)
--
--   lc_fx_links: ตาราง join ระหว่าง LC ตัวแม่ ↔ FX Forward หลายตัว
--     allocated_amount = ยอดที่จัดสรรให้ FX ตัวนั้น (เช่น แบ่ง 50/50) — logic การตัดจริง "ข้อ 5" ค่อยทำหลัง Confirm
--
--   *** ฟีเจอร์ใหม่ รอ Reconfirm · logic จัดสรร/ตัด (ข้อ 5) ยังไม่ทำ ***
-- =====================================================================
create table if not exists lc_fx_links (
  id               uuid primary key default gen_random_uuid(),
  lc_id            uuid not null references letters_of_credit(id) on delete cascade,
  fxf_id           uuid not null references fx_forwards(id)       on delete cascade,
  allocated_amount numeric(18,2),      -- ยอดจัดสรรให้ FX ตัวนี้ (null = ยังไม่ระบุ)
  remark           text,
  created_at       timestamptz not null default now(),
  constraint uq_lc_fx_links unique (lc_id, fxf_id)
);
create index if not exists idx_lc_fx_links_lc  on lc_fx_links(lc_id);
create index if not exists idx_lc_fx_links_fxf on lc_fx_links(fxf_id);

alter table lc_fx_links enable row level security;
do $$ begin
  create policy anon_all_lc_fx_links on lc_fx_links for all using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on table lc_fx_links is 'LC ตัวแม่ ↔ FX Forward หลายตัว (MoM 30Sep2026: 1 LC ผูก FX ได้หลายรายการ) · ตัวลูกเลือก FX จากชุดนี้';
