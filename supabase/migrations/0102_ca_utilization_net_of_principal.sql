-- ============================================================================
-- 0102 · จ่ายคืนเงินต้นบางส่วนแล้ว วงเงินคืนตามสัดส่วน
-- ============================================================================
--
-- ปัญหาเดิม
--   ยอดใช้วงเงินนับจากยอดตามสัญญาเต็มจำนวนเสมอ ตั๋วสัญญาใช้เงิน 10 ล้าน
--   จ่ายคืนเงินต้นไปแล้ว 4 ล้าน วงเงินยังถูกล็อกไว้ 10 ล้านเท่าเดิม
--   จะคืนก็ต่อเมื่อสถานะเปลี่ยนเป็นชำระครบ/ปิดสัญญา คือจ่ายครบทั้งก้อนเท่านั้น
--   เป็นแบบได้หมดหรือไม่ได้เลย ซึ่งไม่ตรงกับวิธีทำงานจริงของวงเงินหมุนเวียน
--
-- สิ่งที่ไฟล์นี้ทำ
--   เปลี่ยนฐานการนับจาก "ยอดตามสัญญา" เป็น "ยอดคงเหลือ"
--       ยอดคงเหลือ = ยอดตามสัญญา − เงินต้นที่จ่ายคืนแล้ว
--   จ่ายคืน 4 ล้าน วงเงินคืนมา 4 ล้านทันที ไม่ต้องรอปิดสัญญา
--
--   ไม่เพิ่มคอลัมน์เก็บยอดคงเหลือ เพราะจะมีค่าเดียวกันอยู่สองที่แล้วเพี้ยนออกจากกัน
--   คำนวณจากใบตัดชำระที่มีอยู่แล้วแทน
-- ============================================================================


-- ── โมดูลไหนหักเงินต้นที่จ่ายคืน โมดูลไหนไม่หัก ─────────────────────────────
--
-- หัก — วงเงินที่เบิกเป็นก้อนแล้วทยอยคืน ยอดคงเหลือลดลงจริง
--   เงินกู้ยืม · ตั๋วสัญญาใช้เงิน · ทรัสต์รีซีท · สินเชื่อสต๊อกรถ ·
--   หนังสือเครดิต · สัญญาเช่า
--
-- ไม่หัก — 3 โมดูลนี้ยอดตามสัญญาไม่ใช่ยอดหนี้ที่ทยอยคืน
--   เบิกเกินบัญชี  ยอดที่บันทึกคือวงเงินที่กันไว้ให้ ไม่ใช่ยอดที่เบิกไปแล้ว
--                  ยอดเบิกจริงมาจากยอดคงเหลือรายวันในใบแจ้งยอดธนาคาร
--                  และเบิกคืนได้หลายรอบในวงเงินเดิม หักออกจะกลายเป็นวงเงินโตขึ้นเรื่อยๆ
--   หนังสือค้ำประกัน ยังไม่เป็นหนี้จนกว่าธนาคารจะถูกเรียกให้จ่ายแทน
--                  กันวงเงินเต็มจำนวนจนกว่าจะหมดอายุหรือยกเลิก
--   สัญญาซื้อขายเงินตราล่วงหน้า  ยอดตามสัญญาเป็นยอดอ้างอิงเพื่อคำนวณ
--                  ไม่ใช่เงินที่ยืมมา ปิดทีเดียวตอนส่งมอบ


-- ── เงินต้นที่จ่ายคืนแล้วของสัญญาหนึ่งฉบับ ──────────────────────────────────
--
-- ใบตัดชำระอ้างสัญญาด้วยรหัสประเภทวงเงิน ซึ่งบางประเภทมีหลายรหัสชี้ตารางเดียวกัน
--   สัญญาเช่ากับเช่าซื้อ (Lease / HP) ใช้ตาราง leases ร่วมกัน
--   หนังสือค้ำประกันมีรหัสเก่าติดมาด้วย (LG / BG)
-- จึงรับเป็นรายการรหัส ไม่ใช่รหัสเดียว
create or replace function facility_principal_repaid(p_codes text[], p_id uuid)
returns numeric language sql stable as $$
  select coalesce((
    select sum(rl.amount)
      from repayment_lines rl
      join repayments r on r.id = rl.repayment_id
     where rl.facility_id = p_id
       and rl.facility_type = any (p_codes)
       and rl.category = 'Principal'
       and r.status = 'Posted'      -- ใบที่ยังร่างอยู่หรือกลับรายการแล้วไม่นับ
  ), 0)
$$;

-- เงินกู้ยืมมีอีกทางหนึ่ง — เมนูชำระก่อนกำหนดของตัวเอง ไม่ได้ผ่านเมนูรับชำระ
create or replace function loan_principal_prepaid(p_loan_id uuid)
returns numeric language sql stable as $$
  select coalesce((select sum(amount) from loan_prepayments where loan_id = p_loan_id), 0)
$$;

-- สินเชื่อสต๊อกรถมีอีกทางหนึ่ง — การทยอยคืนเงินต้นตามขั้นบันได
-- บันทึกเป็นใบสำคัญอย่างเดียว ไม่ได้สร้างใบตัดชำระ
-- ยอดที่คืนคือด้านเดบิตของใบสำคัญนั้น (เดบิตเจ้าหนี้ เครดิตเงินสด)
create or replace function fp_principal_curtailed(p_fp_id uuid)
returns numeric language sql stable as $$
  select coalesce((
    select sum(total_dr)
      from journal_entries
     where source_type = 'FP_CURTAIL'
       and source_id   = p_fp_id
       and status      = 'Posted'
       and is_reversal = false
  ), 0)
$$;


-- ── ตัวคำนวณหลัก — เปลี่ยนจากยอดสัญญาเป็นยอดคงเหลือ ─────────────────────────
--
-- greatest(..., 0) กันกรณีจ่ายเกินยอดสัญญา ซึ่งเกิดได้จริงเวลาบันทึกผิด
-- ถ้าไม่กัน ยอดจะติดลบแล้วไปเพิ่มวงเงินให้สัญญาฉบับอื่นโดยไม่มีใครรู้ตัว
create or replace function recalc_ca_utilization(p_ca_id uuid)
returns void language plpgsql as $$
declare
  v_non_revolving boolean;
  v_skip          text[];
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

    -- ── หักเงินต้นที่จ่ายคืนแล้ว ──────────────────────────────────────────
    select greatest(principal
                    - facility_principal_repaid(array['Loan'], id)
                    - loan_principal_prepaid(id), 0) as amt
      from loans
     where ca_id = p_ca_id and not (status::text = any (v_skip || array['Modified']))
    union all
    select greatest(amount - facility_principal_repaid(array['PN'], id), 0)
      from promissory_notes
     where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select greatest(amount - facility_principal_repaid(array['TR'], id), 0)
      from trust_receipts
     where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select greatest(amount
                    - facility_principal_repaid(array['FP'], id)
                    - fp_principal_curtailed(id), 0)
      from floor_plans
     where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select greatest(amount - facility_principal_repaid(array['LC'], id), 0)
      from letters_of_credit
     where ca_id = p_ca_id and not (status::text = any (v_skip))
       and parent_lc_id is null                 -- นับเฉพาะสัญญาแม่
    union all
    select greatest(principal - facility_principal_repaid(array['Lease','HP'], id), 0)
      from leases
     where ca_id = p_ca_id and not (status::text = any (v_skip))

    -- ── ไม่หัก — เหตุผลอยู่ในหัวไฟล์ ──────────────────────────────────────
    union all
    select amount     from overdrafts
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount     from letter_guarantees
      where ca_id = p_ca_id and not (status::text = any (v_skip))
    union all
    select amount_thb from fx_forwards            -- ยอดบาท ไม่ใช่สกุลต่างประเทศ
      where ca_id = p_ca_id and not (status::text = any (v_skip))
  ) t;

  update credit_agreements
     set utilization = v_used
   where id = p_ca_id
     and coalesce(utilization, -1) is distinct from v_used;
end $$;


-- ── สะกิดให้คำนวณใหม่เมื่อมีการตัดชำระ ──────────────────────────────────────
--
-- เดิมสะกิดเฉพาะตอนตัวสัญญาเปลี่ยน แต่ตอนนี้ยอดใช้วงเงินขึ้นกับใบตัดชำระด้วย
-- ถ้าไม่สะกิด บันทึกรับชำระแล้ววงเงินจะยังไม่คืนจนกว่าจะมีคนไปแตะสัญญา
-- ใบตัดชำระอ้างสัญญาแบบไม่ผูกคีย์ (เก็บแค่รหัสประเภท + รหัสสัญญา)
-- จึงต้องไล่หาเองว่ารหัสนี้อยู่ตารางไหน แล้วสัญญานั้นอยู่ใต้วงเงินใบไหน
create or replace function recalc_ca_for_facility(p_facility_id uuid)
returns void language plpgsql as $$
declare v_ca uuid;
begin
  if p_facility_id is null then return; end if;

  select f.ca_id into v_ca from (
    select id, ca_id from loans             union all
    select id, ca_id from promissory_notes  union all
    select id, ca_id from trust_receipts    union all
    select id, ca_id from floor_plans       union all
    select id, ca_id from letters_of_credit union all
    select id, ca_id from leases            union all
    select id, ca_id from overdrafts        union all
    select id, ca_id from letter_guarantees union all
    select id, ca_id from fx_forwards
  ) f where f.id = p_facility_id;

  if v_ca is not null then
    perform recalc_ca_utilization(v_ca);
  end if;
end $$;

create or replace function trg_recalc_ca_from_repayment()
returns trigger language plpgsql as $$
begin
  perform recalc_ca_for_facility(coalesce(new.facility_id, old.facility_id));
  return null;
end $$;

drop trigger if exists trg_rp_lines_ca_util on repayment_lines;
create trigger trg_rp_lines_ca_util
  after insert or update or delete on repayment_lines
  for each row execute function trg_recalc_ca_from_repayment();

-- ใบตัดชำระเปลี่ยนสถานะ (ร่าง → ลงบัญชี → กลับรายการ) ตัวบรรทัดไม่ขยับ
-- แต่ยอดที่นับเปลี่ยน เพราะนับเฉพาะใบที่ลงบัญชีแล้ว จึงต้องสะกิดที่หัวใบด้วย
create or replace function trg_recalc_ca_from_repayment_header()
returns trigger language plpgsql as $$
declare r record;
begin
  for r in
    select distinct facility_id
      from repayment_lines
     where repayment_id = coalesce(new.id, old.id)
       and facility_id is not null
  loop
    perform recalc_ca_for_facility(r.facility_id);
  end loop;
  return null;
end $$;

drop trigger if exists trg_rp_header_ca_util on repayments;
create trigger trg_rp_header_ca_util
  after insert or update or delete on repayments
  for each row execute function trg_recalc_ca_from_repayment_header();

-- เมนูชำระก่อนกำหนดของเงินกู้ยืม
create or replace function trg_recalc_ca_from_loan_prepay()
returns trigger language plpgsql as $$
declare v_ca uuid;
begin
  select ca_id into v_ca from loans where id = coalesce(new.loan_id, old.loan_id);
  if v_ca is not null then perform recalc_ca_utilization(v_ca); end if;
  return null;
end $$;

drop trigger if exists trg_loan_prepay_ca_util on loan_prepayments;
create trigger trg_loan_prepay_ca_util
  after insert or update or delete on loan_prepayments
  for each row execute function trg_recalc_ca_from_loan_prepay();

-- การทยอยคืนเงินต้นของสินเชื่อสต๊อกรถ บันทึกเป็นใบสำคัญอย่างเดียว
create or replace function trg_recalc_ca_from_je()
returns trigger language plpgsql as $$
declare v_ca uuid;
begin
  if coalesce(new.source_type, old.source_type) <> 'FP_CURTAIL' then return null; end if;
  select ca_id into v_ca
    from floor_plans
   where id = coalesce(new.source_id, old.source_id);
  if v_ca is not null then perform recalc_ca_utilization(v_ca); end if;
  return null;
end $$;

drop trigger if exists trg_je_fp_curtail_ca_util on journal_entries;
create trigger trg_je_fp_curtail_ca_util
  after insert or update or delete on journal_entries
  for each row execute function trg_recalc_ca_from_je();


-- ── คำนวณใหม่ทั้งหมดด้วยกติกาใหม่ ───────────────────────────────────────────
do $$
declare r record;
begin
  for r in select id from credit_agreements loop
    perform recalc_ca_utilization(r.id);
  end loop;
  for r in select id from master_agreements loop
    perform recalc_ma_from_ca(r.id);
  end loop;
end $$;


comment on function facility_principal_repaid(text[], uuid) is
  'เงินต้นที่จ่ายคืนแล้วของสัญญาหนึ่งฉบับ นับเฉพาะใบตัดชำระที่ลงบัญชีแล้ว';
comment on column credit_agreements.utilization is
  'ยอดใช้วงเงิน = ยอดคงเหลือของทุกสัญญาใต้วงเงินนี้ (ยอดสัญญา − เงินต้นที่จ่ายคืนแล้ว) · ฐานข้อมูลคำนวณให้ ห้ามแก้มือ';
