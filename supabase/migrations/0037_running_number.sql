-- =====================================================================
--  Running Number (system-generated contract no.) — MoM Day3 §7/§43–44/§99 (Confirmed)
--  "ระบบจะ Generate Running Number ของตัวเองให้ทุกสัญญา (ไม่ทับซ้อนแม้สัญญาเดิมถูกปิด/ลบ)"
--  เก็บคู่กับ "เลขที่สัญญาธนาคาร" (Bank Reference — user key เอง)
--  ใช้ counter table + atomic upsert → ไม่มีวันซ้ำ แม้ลบ/ปิดสัญญา
-- =====================================================================
create table if not exists running_counters (
  prefix   text primary key,
  last_no  bigint not null default 0
);
alter table running_counters enable row level security;
do $$ begin
  create policy anon_all_running_counters on running_counters for all using (true) with check (true);
exception when duplicate_object then null; end $$;

create or replace function next_running_no(p_prefix text) returns text
language plpgsql as $$
declare n bigint;
begin
  insert into running_counters(prefix, last_no) values (p_prefix, 1)
    on conflict (prefix) do update set last_no = running_counters.last_no + 1
    returning last_no into n;
  return p_prefix || lpad(n::text, 5, '0');
end $$;
