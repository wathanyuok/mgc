-- 0097 — เอกสารแนบของสัญญาเช่า
--
-- ทุกโมดูลสัญญาแนบไฟล์ได้อยู่แล้ว (สัญญา · ใบกำกับภาษี · เอกสารโอนกรรมสิทธิ์)
-- ยกเว้นสัญญาเช่าที่แท็บ Document ยังเป็นข้อความอธิบายเฉยๆ แนบไฟล์จริงไม่ได้
-- ตารางนี้ทำให้ใช้ตัวแนบไฟล์ตัวเดียวกับโมดูลอื่นได้
--
-- ใช้ร่วมกันทั้ง 3 ชนิด — Hire Purchase · Leasing · Leasing Other

create table if not exists lease_documents (
  id            uuid primary key default uuid_generate_v4(),
  lease_id      uuid not null references leases(id) on delete cascade,
  file_name     text not null,
  file_type     text,
  size_bytes    bigint,
  storage_path  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_lease_doc_lease on lease_documents(lease_id);

alter table lease_documents enable row level security;
drop policy if exists "anon_all_lease_documents" on lease_documents;
create policy "anon_all_lease_documents" on lease_documents for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('lease-documents', 'lease-documents', true)
on conflict (id) do nothing;

comment on table lease_documents is
  'เอกสารแนบของสัญญาเช่า — ใช้ร่วมกันทั้งเช่าซื้อ เช่า และสัญญาเช่าอื่น';
