-- ============================================================================
-- 0101 · ยอดใช้วงเงินไหลขึ้นครบสาย  ธุรกรรม → CA → MA รายบริษัทย่อย → MA รวม
-- ============================================================================
--
-- ปัญหาเดิม
--   credit_agreements.utilization เป็นคอลัมน์เก็บค่า แต่ไม่มีใครเขียนเลย
--   ทั้งในหน้าจอและในฐานข้อมูล ค่าที่เห็นค้างมาจากตอนใส่ข้อมูลตัวอย่างครั้งแรก
--   เปิดตั๋วสัญญาใช้เงินใหม่ 10 ล้าน ตัวเลขบน CA ไม่ขยับ และเพราะ MA รวมยอด
--   มาจากตรงนี้ ตัวเลขบน MA ก็ไม่ขยับตาม
--
--   ตัวคำนวณยอดใช้วงเงินมีอยู่ที่ src/lib/credit-limit.ts แต่คำนวณสดตอนกดบันทึก
--   เพื่อเช็คว่าเกินวงเงินไหม แล้วทิ้งผลลัพธ์ไป ไม่ได้เขียนกลับลงตาราง
--
-- สิ่งที่ไฟล์นี้ทำ
--   ย้ายกติกาเดียวกันนั้นมาไว้ในฐานข้อมูล แล้วให้คำนวณใหม่อัตโนมัติทุกครั้ง
--   ที่ธุรกรรมถูกเพิ่ม แก้ไข หรือลบ — ครอบทุกทางเข้ารวมถึงการนำเข้าข้อมูล
--   และการแก้ผ่านหน้าจอฐานข้อมูลโดยตรง ซึ่งการทำในหน้าจอครอบไม่ถึง
--
-- ท่อนบนของสายต่อไว้อยู่แล้ว (0001_init.sql: recalc_ma_utilization)
--   ไฟล์นี้จึงเติมเฉพาะท่อนล่างสุดที่ขาด
-- ============================================================================


-- ── กติกาการนับ ─────────────────────────────────────────────────────────────
--
-- ต้องตรงกับ src/lib/credit-limit.ts เป๊ะ ไม่งั้นหน้าจอกับรายงานจะบอกตัวเลข
-- คนละอย่างบนวงเงินใบเดียวกัน — ซึ่งเคยเกิดมาแล้วตอนที่สองที่แยกกันคนละไฟล์

-- สถานะที่แปลว่า "สัญญาจบแล้ว วงเงินคืนมา" — ใช้กับวงเงินหมุนเวียน
create or replace function ca_closed_statuses()
returns text[] language sql immutable as $$
  select array[
    'Repaid', 'Closed', 'Cancelled', 'Rejected', 'Roll Over', 'Voided',
    'Expired', 'Terminated', 'Converted', 'Settled'
  ]
$$;

-- วงเงินแบบไม่หมุนเวียน เบิกแล้วกินวงเงินถาวร คืนก็ไม่ได้วงเงินกลับ
-- คัดออกเฉพาะสถานะที่แปลว่า "ไม่เคยเบิกเลย"
create or replace function ca_never_drew_statuses()
returns text[] language sql immutable as $$
  select array['Cancelled', 'Rejected', 'Voided']
$$;


-- ── ตัวคำนวณหลัก ────────────────────────────────────────────────────────────
--
-- รวมยอดจากทุกตารางธุรกรรมที่ผูกวงเงินใบนี้ แล้วเขียนกลับลง credit_agreements
--
-- ข้อควรรู้ 3 ข้อที่ฝังอยู่ในตรรกะนี้
--   1. "Modified" ในเงินกู้ยืม = แก้เงื่อนไขแล้วเปิดสัญญาใหม่แทน สัญญาเดิมจบแล้ว
--      ต้องคัดออก ไม่งั้นวงเงินถูกนับทั้งสัญญาเดิมและสัญญาใหม่ = ใช้ซ้ำสองเท่า
--      แต่ "Modified" ในสัญญาเช่า = ปรับมูลค่าในสัญญาฉบับเดิม ยังมีผลบังคับใช้
--      จึงต้องยังกินวงเงินอยู่ — ห้ามคัดออก
--   2. หนังสือเครดิตที่แบ่งรับมอบเป็นล็อต จะสร้างสัญญาย่อยผูกวงเงินใบเดียวกัน
--      นับเฉพาะสัญญาแม่ ไม่งั้นนับซ้ำสองเท่า
--   3. สัญญาซื้อขายเงินตราล่วงหน้ากินวงเงินด้วยยอดบาท ไม่ใช่ยอดสกุลต่างประเทศ
--
-- หมายเหตุทางเทคนิค: คอลัมน์ status ของทุกตารางเป็นชนิดกำหนดค่าเอง (enum)
-- คนละชนิดกันทุกตาราง จึงต้องแปลงเป็นข้อความก่อนเทียบ ไม่งั้นฐานข้อมูลฟ้องชนิดไม่ตรง
create or replace function recalc_ca_utilization(p_ca_id uuid)
returns void language plpgsql as $$
declare
  v_non_revolving boolean;
  v_skip          text[];   -- สถานะที่ไม่นับ
  v_used          numeric := 0;
begin
  if p_ca_id is null then return; end if;

  select coalesce(credit_type, '') ilike '%non%'
    into v_non_revolving
    from credit_agreements
   where id = p_ca_id;

  if not found then return; end if;

  v_skip := case when v_non_revolving
                 then ca_never_drew_statuses()
                 else ca_closed_statuses() end;

  select coalesce(sum(amt), 0) into v_used from (
    select principal  as amt from loans
      where ca_id = p_ca_id and not (status::text = any (v_skip || array['Modified']))
    union all
    select amount     from promissory_notes
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount     from letter_guarantees
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount     from letters_of_credit
      where ca_id = p_ca_id and not (status::text = any (v_skip))
        and parent_lc_id is null                 -- นับเฉพาะสัญญาแม่
    union all
    select amount     from floor_plans
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount     from overdrafts
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount     from trust_receipts
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount_thb from fx_forwards            -- ยอดบาท ไม่ใช่สกุลต่างประเทศ
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select principal  from leases
      where ca_id = p_ca_id and not (status::text = any (v_skip))
  ) t;

  update credit_agreements
     set utilization = v_used
   where id = p_ca_id
     and coalesce(utilization, -1) is distinct from v_used;   -- ไม่แตะถ้าค่าเท่าเดิม
end $$;


-- ── ตัวสะกิดให้คำนวณใหม่ ────────────────────────────────────────────────────
--
-- ต้องคำนวณทั้งวงเงินใบเก่าและใบใหม่ เพราะย้ายธุรกรรมข้ามวงเงินได้
-- ถ้าคำนวณแต่ใบใหม่ ใบเก่าจะค้างยอดของธุรกรรมที่ย้ายออกไปแล้ว
create or replace function trg_recalc_ca_utilization()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.ca_id is not null then
    perform recalc_ca_utilization(old.ca_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.ca_id is not null then
    perform recalc_ca_utilization(new.ca_id);
  end if;
  return null;   -- after trigger ไม่ต้องคืนแถว
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'loans', 'promissory_notes', 'letter_guarantees', 'letters_of_credit',
    'floor_plans', 'overdrafts', 'trust_receipts', 'fx_forwards', 'leases'
  ] loop
    execute format('drop trigger if exists trg_%I_ca_util on %I', t, t);
    execute format(
      'create trigger trg_%I_ca_util after insert or update or delete on %I'
      ' for each row execute function trg_recalc_ca_utilization()', t, t);
  end loop;
end $$;


-- ── เติมค่าย้อนหลังให้ข้อมูลที่มีอยู่ ────────────────────────────────────────
--
-- ค่าที่ค้างอยู่ตอนนี้มาจากข้อมูลตัวอย่าง ไม่ได้คำนวณจากธุรกรรมจริง
-- ต้องคำนวณใหม่ทั้งหมดครั้งเดียว ไม่งั้นวงเงินเก่าจะยังผิดต่อไป
do $$
declare r record;
begin
  for r in select id from credit_agreements loop
    perform recalc_ca_utilization(r.id);
  end loop;
end $$;


-- ── ท่อนบนของสาย: CA → MA รายบริษัทย่อย ─────────────────────────────────────
--
-- เดิมหน้าจอ MA รวมยอดจาก CA ให้ตอนเปิดหน้า แล้วเขียนลง ma_subsidiaries
-- ตอนกดบันทึกเท่านั้น — แปลว่าถ้าไม่มีใครเปิดหน้า MA แล้วกดบันทึก
-- ยอดในตารางจะค้างอยู่อย่างนั้น รายงานที่อ่านจากตารางตรงๆ จึงเห็นเลขเก่า
--
-- ย้ายมาให้ฐานข้อมูลทำแทน จะได้ไหลขึ้นทันทีโดยไม่ต้องรอใครเปิดหน้าจอ
create or replace function recalc_ma_from_ca(p_ma_id uuid)
returns void language plpgsql as $$
begin
  if p_ma_id is null then return; end if;

  update ma_subsidiaries s
     set utilization = coalesce((
           select sum(c.utilization)
             from credit_agreements c
            where c.ma_id = p_ma_id
              and c.subsidiary = s.subsidiary
         ), 0)
   where s.ma_id = p_ma_id
     and s.utilization is distinct from coalesce((
           select sum(c.utilization)
             from credit_agreements c
            where c.ma_id = p_ma_id
              and c.subsidiary = s.subsidiary
         ), 0);

  -- ถ้า MA ไม่ได้แบ่งวงเงินรายบริษัทย่อยไว้ ตัวคำนวณข้างบนจะไม่มีแถวให้อัปเดต
  -- ยอดรวมระดับ MA จึงต้องรวมจาก CA ตรงๆ แทน
  if not exists (select 1 from ma_subsidiaries where ma_id = p_ma_id) then
    update master_agreements
       set utilization = coalesce((
             select sum(utilization) from credit_agreements where ma_id = p_ma_id
           ), 0)
     where id = p_ma_id
       and utilization is distinct from coalesce((
             select sum(utilization) from credit_agreements where ma_id = p_ma_id
           ), 0);
  end if;
  -- กรณีมีแถวรายบริษัทย่อย ตัวคำนวณเดิม (trg_subs_recalc) จะรวมขึ้น MA ให้เอง
end $$;

create or replace function trg_recalc_ma_from_ca()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.ma_id is not null then
    perform recalc_ma_from_ca(old.ma_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.ma_id is not null then
    perform recalc_ma_from_ca(new.ma_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_ca_ma_util on credit_agreements;
create trigger trg_ca_ma_util
  after insert or update or delete on credit_agreements
  for each row execute function trg_recalc_ma_from_ca();

-- เติมค่าย้อนหลังให้ MA ทุกใบ
do $$
declare r record;
begin
  for r in select id from master_agreements loop
    perform recalc_ma_from_ca(r.id);
  end loop;
end $$;


-- ── กันค่าที่หน้าจอส่งมาทับของจริง ──────────────────────────────────────────
--
-- หน้าจอ MA ลบแถวบริษัทย่อยทิ้งแล้วสร้างใหม่ทุกครั้งที่กดบันทึก พร้อมส่งยอดใช้
-- วงเงินที่คำนวณไว้ตอนเปิดหน้ามาด้วย ถ้าระหว่างนั้นมีคนเปิดธุรกรรมใหม่
-- ค่าที่ส่งมาจะเป็นของเก่า และจะทับค่าที่ถูกต้องทิ้ง
--
-- ตัวนี้เขียนทับค่าที่ส่งเข้ามาด้วยยอดจริงจากวงเงินย่อยเสมอ
-- ไม่ว่าใครจะส่งอะไรมา — ยอดใช้วงเงินเป็นค่าที่คำนวณ ไม่ใช่ค่าที่กรอก
create or replace function trg_ma_sub_fill_utilization()
returns trigger language plpgsql as $$
begin
  new.utilization := coalesce((
    select sum(c.utilization)
      from credit_agreements c
     where c.ma_id = new.ma_id
       and c.subsidiary = new.subsidiary
  ), 0);
  return new;
end $$;

drop trigger if exists trg_ma_sub_fill_util on ma_subsidiaries;
create trigger trg_ma_sub_fill_util
  before insert or update on ma_subsidiaries
  for each row execute function trg_ma_sub_fill_utilization();


-- ── คำอธิบายติดไว้กับคอลัมน์ ────────────────────────────────────────────────
comment on column credit_agreements.utilization is
  'ยอดใช้วงเงิน — ฐานข้อมูลคำนวณให้อัตโนมัติจากธุรกรรมใต้วงเงินนี้ ห้ามแก้มือ';
comment on column ma_subsidiaries.utilization is
  'ยอดใช้วงเงินของบริษัทย่อย — รวมจากวงเงินย่อยทุกใบอัตโนมัติ ห้ามแก้มือ';
comment on column master_agreements.utilization is
  'ยอดใช้วงเงินรวม — รวมจากบริษัทย่อยทุกรายอัตโนมัติ ห้ามแก้มือ';
