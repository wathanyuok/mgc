-- ============================================================================
-- 0104 · ผู้ใช้ดูแลบริษัทไหนได้บ้าง + บริษัทเจ้าของสัญญาเช่า
-- ============================================================================
--
-- ที่มา — บันทึกประชุม
--   "Row-level: user เห็นเฉพาะบริษัทที่สังกัด (Level 1) · NGC (Level 0) เห็นทั้งกลุ่ม"
--   "พนักงานบัญชีอยู่สังกัด NGC หมดเลย แต่จริงๆ เขาดูบริษัท
--    ก็คือให้เห็นเฉพาะบริษัทของตัวเองเท่านั้น ไม่เห็นทั้งหมด"
--   ทำแบบใช้บริการร่วม (share service) หนึ่งคนดูแลได้หลายบริษัท จึงเก็บเป็นตารางแยก
--   ไม่ใช่คอลัมน์เดียวในตารางผู้ใช้
--
-- เรื่องนี้ตกหล่นตอนแปลงบันทึกประชุมเป็นเอกสารความต้องการ — เอกสารเขียนแต่สิทธิ์ระดับเมนู
-- ระบบจึงกำหนดได้แค่ว่าเข้าเมนูไหนได้ ไม่ได้กำหนดว่าเห็นข้อมูลของบริษัทไหน
-- ============================================================================


-- ── 1. บริษัทที่ผู้ใช้แต่ละคนดูแล ───────────────────────────────────────────
--
-- หนึ่งคนมีได้หลายแถว · ไม่มีแถวเลย = ยังไม่ได้กำหนด ไม่เห็นอะไร
-- ปลอดภัยกว่าให้เห็นทุกอย่างเมื่อยังไม่ได้ตั้งค่า
create table if not exists app_user_subsidiaries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_users(id) on delete cascade,
  subsidiary_id uuid not null references subsidiaries(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (user_id, subsidiary_id)
);
create index if not exists idx_user_subs_user on app_user_subsidiaries(user_id);
create index if not exists idx_user_subs_sub  on app_user_subsidiaries(subsidiary_id);

comment on table app_user_subsidiaries is
  'บริษัทที่ผู้ใช้คนนี้ดูแล · หนึ่งคนหลายบริษัทได้ (กรณีดูแลงานให้หลายบริษัท)';

-- ธงสำหรับคนที่ต้องเห็นทั้งกลุ่ม เช่น บัญชีกลุ่มและผู้บริหาร
--
-- ใช้ธงแทนการใส่ทั้ง 16 บริษัทให้ทีละแถว เพราะถ้าเปิดบริษัทใหม่
-- จะต้องไล่แก้ผู้ใช้ทุกคนที่เป็นระดับกลุ่ม
alter table app_users
  add column if not exists all_subsidiaries boolean not null default false;

comment on column app_users.all_subsidiaries is
  'ดูแลทุกบริษัทในกลุ่ม · ใช้กับบัญชีกลุ่มและผู้บริหาร · ถ้าเป็นจริงไม่ต้องดูตาราง app_user_subsidiaries';


-- ── 2. สายบริษัทแม่-ลูก ตามผังองค์กร ────────────────────────────────────────
--
-- เดิมเก็บ 16 บริษัทเป็นรายการแบน ไม่รู้ว่าใครอยู่ใต้ใคร
-- ยังไม่ได้เอาไปใช้กรองสิทธิ์ (รอลูกค้ายืนยันว่าคนที่ดูแลบริษัทแม่
-- ควรเห็นข้อมูลของบริษัทลูกด้วยหรือไม่) แต่เก็บไว้ก่อนจะได้ไม่ต้องไล่ถามใหม่
alter table subsidiaries
  add column if not exists parent_subsidiary_id uuid references subsidiaries(id) on delete set null;

create index if not exists idx_sub_parent on subsidiaries(parent_subsidiary_id);

comment on column subsidiaries.parent_subsidiary_id is
  'บริษัทแม่ตามผังองค์กร · ว่าง = บริษัทระดับบนสุด';

-- เติมสายตามผังองค์กรที่ลูกค้าให้มา
do $$
declare
  v_mgc uuid; v_neo uuid; v_mcr uuid;
begin
  select id into v_mgc from subsidiaries where code = 'MGC';
  select id into v_neo from subsidiaries where code = 'NEO';
  select id into v_mcr from subsidiaries where code = 'MCR';

  -- บริษัทลูกของบริษัทแม่
  update subsidiaries set parent_subsidiary_id = v_mgc
   where code in ('i24','NEO','MGT','MAG','MCR','SHA','MMS','USM','GW','AZM','MAC')
     and v_mgc is not null;

  -- บริษัทหลาน
  update subsidiaries set parent_subsidiary_id = v_neo
   where code in ('ZMP','XMT','XMP') and v_neo is not null;
  update subsidiaries set parent_subsidiary_id = v_mcr
   where code = 'MDS' and v_mcr is not null;

  -- บริษัทแม่ไม่มีแม่
  update subsidiaries set parent_subsidiary_id = null where code = 'MGC';
end $$;


-- ── 3. บริษัทเจ้าของสัญญาเช่า ───────────────────────────────────────────────
--
-- สัญญาเช่าที่ใช้สินเชื่อธนาคาร (เช่าซื้อ · เช่าดำเนินงาน) รู้บริษัทได้จากสายวงเงิน
--   สัญญาเช่า → วงเงินย่อย → บริษัท
--
-- แต่สัญญาเช่าอื่น (เช่าที่ดิน อาคาร โกดัง) ไม่ผูกวงเงิน — บันทึกประชุมบอกว่า
--   "สัญญาเช่ายังไม่มี credit agreement · ก็ว่างได้ ไม่ต้องกรอกครับ"
-- จึงไม่มีทางไล่ขึ้นไปหาบริษัท ต้องระบุเอง
--
-- ไม่ใช่แค่เรื่องจำกัดสิทธิ์ — ค่าเช่าต้องลงเป็นค่าใช้จ่ายของบริษัทใดบริษัทหนึ่ง
-- และใบสำคัญที่ส่งไประบบบัญชีปลายทางต้องแนบรหัสบริษัทเสมอ
alter table leases
  add column if not exists subsidiary text;

create index if not exists idx_lease_subsidiary on leases(subsidiary);

comment on column leases.subsidiary is
  'บริษัทเจ้าของสัญญา (ชื่อย่อตามผังองค์กร) · โหมดที่ใช้สินเชื่อธนาคารดึงจากวงเงินย่อย แก้เองไม่ได้ · โหมดอื่นเลือกเอง บังคับกรอก';

-- เติมค่าย้อนหลังให้สัญญาที่ผูกวงเงินอยู่แล้ว
update leases l
   set subsidiary = c.subsidiary
  from credit_agreements c
 where l.ca_id = c.id
   and l.subsidiary is null
   and c.subsidiary is not null;


-- ── สิทธิ์เข้าถึงตาราง — เปิดไว้เหมือนตารางอื่นในต้นแบบ ─────────────────────
alter table app_user_subsidiaries enable row level security;
drop policy if exists "anon_all_app_user_subsidiaries" on app_user_subsidiaries;
create policy "anon_all_app_user_subsidiaries" on app_user_subsidiaries
  for all using (true) with check (true);
