-- ============================================================================
-- 0105 · ผู้ใช้ทุกคนต้องมีบริษัทที่ดูแลเสมอ
-- ============================================================================
--
-- ที่มา
--   0104 เพิ่มที่เก็บบริษัทที่ผู้ใช้ดูแล แต่ไม่ได้บังคับว่าต้องมี
--   หน้าจอบังคับอยู่ก็จริง แต่การนำเข้าข้อมูลหรือแก้ผ่านหน้าจอฐานข้อมูลข้ามได้
--   ผู้ใช้ที่หลุดออกมาแบบนั้นจะเข้าระบบได้แต่ไม่เห็นข้อมูลอะไรเลย
--   แล้วไม่มีใครรู้ว่าเพราะยังไม่ได้ตั้งค่า หรือเพราะตั้งใจไม่ให้เห็น
--
--   ไฟล์นี้ย้ายการบังคับมาไว้ที่ฐานข้อมูล — ผิดกฎเขียนไม่ผ่านไม่ว่าจะเข้ามาทางไหน
--   สภาพ "ยังไม่ได้กำหนดบริษัท" จึงเกิดขึ้นไม่ได้อีก
-- ============================================================================


-- ── 1. เติมค่าให้ผู้ใช้เดิม ──────────────────────────────────────────────────
--
-- ผู้ใช้ที่สร้างไว้ก่อนมีเรื่องนี้ ยังไม่มีบริษัทสักแถว
-- ถ้าบังคับกฎก่อนเติมค่า จะแก้ผู้ใช้เดิมไม่ได้เลยสักคน
--
-- ให้ "ดูแลทุกบริษัท" ไปก่อน = ใช้งานได้เหมือนเดิมก่อนมีเรื่องนี้ ไม่มีใครทำงานสะดุด
-- ผู้ดูแลระบบค่อยไล่จำกัดทีหลัง และเห็นชัดว่าใครยังไม่ได้ตั้งค่าจริงจัง
update app_users
   set all_subsidiaries = true
 where all_subsidiaries = false
   and not exists (select 1 from app_user_subsidiaries s where s.user_id = app_users.id);


-- ── 2. กฎ — ต้องมีบริษัทเสมอ ────────────────────────────────────────────────
--
-- ตรวจตอนเขียนตารางผู้ใช้ และตอนลบแถวบริษัทออก
-- ใช้ตัวสะกิดแทนเงื่อนไขในตาราง เพราะต้องดูข้ามสองตาราง
create or replace function assert_user_has_scope(p_user_id uuid)
returns void language plpgsql as $$
declare v_all boolean; v_count int;
begin
  select all_subsidiaries into v_all from app_users where id = p_user_id;
  if v_all is null then return; end if;          -- ผู้ใช้ถูกลบไปแล้ว
  if v_all then return; end if;                   -- ดูแลทุกบริษัท ไม่ต้องมีรายแถว

  select count(*) into v_count from app_user_subsidiaries where user_id = p_user_id;
  if v_count = 0 then
    raise exception 'ผู้ใช้ต้องมีบริษัทที่ดูแลอย่างน้อยหนึ่งบริษัท หรือตั้งเป็นดูแลทุกบริษัท'
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function trg_user_scope_required()
returns trigger language plpgsql as $$
begin
  perform assert_user_has_scope(coalesce(new.id, old.id));
  return null;
end $$;

create or replace function trg_user_sub_scope_required()
returns trigger language plpgsql as $$
begin
  perform assert_user_has_scope(coalesce(new.user_id, old.user_id));
  return null;
end $$;

-- ตรวจท้ายคำสั่ง ไม่ใช่ท้ายแถว — หน้าจอลบแถวเดิมทิ้งแล้วใส่ใหม่ทั้งชุด
-- ถ้าตรวจทีละแถว จะติดตั้งแต่ตอนลบแถวสุดท้ายทั้งที่กำลังจะใส่ชุดใหม่เข้าไป
drop trigger if exists trg_app_users_scope on app_users;
create constraint trigger trg_app_users_scope
  after insert or update on app_users
  deferrable initially deferred
  for each row execute function trg_user_scope_required();

drop trigger if exists trg_user_subs_scope on app_user_subsidiaries;
create constraint trigger trg_user_subs_scope
  after insert or update or delete on app_user_subsidiaries
  deferrable initially deferred
  for each row execute function trg_user_sub_scope_required();


comment on function assert_user_has_scope(uuid) is
  'ผู้ใช้ต้องมีบริษัทที่ดูแลอย่างน้อยหนึ่งบริษัท หรือตั้งเป็นดูแลทุกบริษัท';
