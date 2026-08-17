-- ข้อมูลตัวอย่างสำหรับรายงาน "รถค้ำประกันซ้ำวงเงิน" — 5 คัน
--   3 คัน = ต่างธนาคาร (ทำได้ตามกฎ แต่ต้องตรวจสอบ · ขึ้นสีส้ม)
--   2 คัน = ธนาคารเดียวกัน (ผิดกฎ · ขึ้นสีแดง)
--
-- สคริปต์จะไปหยิบสัญญาที่ยังไม่ปิดในระบบมาจับคู่ให้เอง — ไม่ต้องแก้ id ใดๆ
-- รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ (ล้างของเดิมที่ขึ้นต้น DEMO- ก่อนทุกครั้ง)

do $$
declare
  r record;
  vin text;
  n int;
  made_cross int := 0;
  made_same  int := 0;
  models text[] := array[
    'BMW X7 xDrive40d', 'BMW 530e M Sport', 'MINI Cooper S 5DR',
    'Audi A6 45 TFSI', 'BMW X5 xDrive40i'
  ];
begin
  -- ── ล้างข้อมูลสาธิตเดิม ──
  delete from fp_chassis   where chassis_no like 'DEMO-%';
  delete from loan_chassis where chassis_no like 'DEMO-%';
  update promissory_notes
     set chassis_list = (
       select coalesce(jsonb_agg(x), '[]'::jsonb)
       from jsonb_array_elements(coalesce(chassis_list, '[]'::jsonb)) x
       where x->>'chassis_no' not like 'DEMO-%'
     )
   where chassis_list::text like '%DEMO-%';

  -- ── รวมสัญญาที่ยังไม่ปิดจากทุกโมดูลไว้ในตารางชั่วคราว ──
  create temp table _slots (kind text, id uuid, bank text) on commit drop;

  insert into _slots
  select 'FP', id, coalesce(finance_institution, '') from floor_plans
  where status::text not in ('Closed','Repaid','Cancelled','Terminated','Rejected','Expired');

  insert into _slots
  select 'LOAN', id, coalesce(finance_institution, '') from loans
  where status::text not in ('Closed','Repaid','Cancelled','Terminated','Rejected','Expired');

  insert into _slots
  select 'PN', id, coalesce(finance_institution, '') from promissory_notes
  where status::text not in ('Closed','Repaid','Cancelled','Terminated','Rejected','Expired');

  -- ── จับคู่ต่างธนาคาร 3 คู่ · ธนาคารเดียวกัน 2 คู่ (ห้ามใช้สัญญาซ้ำข้ามคู่) ──
  create temp table _pairs (seq int, same_bank bool, a_kind text, a_id uuid, b_kind text, b_id uuid) on commit drop;

  -- ต่างธนาคาร
  for r in
    select s1.kind as k1, s1.id as i1, s2.kind as k2, s2.id as i2
    from _slots s1 join _slots s2
      on s2.id <> s1.id and s2.bank <> s1.bank and s1.bank <> '' and s2.bank <> ''
    order by s1.kind, s2.kind
  loop
    exit when made_cross >= 3;
    if exists (select 1 from _pairs where a_id in (r.i1, r.i2) or b_id in (r.i1, r.i2)) then
      continue;
    end if;
    made_cross := made_cross + 1;
    insert into _pairs values (made_cross, false, r.k1, r.i1, r.k2, r.i2);
  end loop;

  -- ธนาคารเดียวกัน
  for r in
    select s1.kind as k1, s1.id as i1, s2.kind as k2, s2.id as i2
    from _slots s1 join _slots s2
      on s2.id <> s1.id and s2.bank = s1.bank and s1.bank <> ''
    order by s1.kind, s2.kind
  loop
    exit when made_same >= 2;
    if exists (select 1 from _pairs where a_id in (r.i1, r.i2) or b_id in (r.i1, r.i2)) then
      continue;
    end if;
    made_same := made_same + 1;
    insert into _pairs values (3 + made_same, true, r.k1, r.i1, r.k2, r.i2);
  end loop;

  -- ── สร้างรถให้แต่ละคู่ ──
  for r in select * from _pairs order by seq loop
    vin := case when r.same_bank then 'DEMO-SAMEBANK-' else 'DEMO-CROSSBANK-' end
           || lpad(r.seq::text, 4, '0');
    n := ((r.seq - 1) % array_length(models, 1)) + 1;

    -- ฝั่ง A
    if r.a_kind = 'FP' then
      insert into fp_chassis (fp_id, chassis_no, model, amount, status)
        values (r.a_id, vin, models[n], 4290000, 'In Stock');
    elsif r.a_kind = 'LOAN' then
      insert into loan_chassis (loan_id, chassis_no, car_model, cost, status)
        values (r.a_id, vin, models[n], 4290000, 'Active');
    else
      update promissory_notes
         set chassis_list = coalesce(chassis_list, '[]'::jsonb)
             || jsonb_build_object('chassis_no', vin, 'model', models[n], 'amount', 4290000)
       where id = r.a_id;
    end if;

    -- ฝั่ง B
    if r.b_kind = 'FP' then
      insert into fp_chassis (fp_id, chassis_no, model, amount, status)
        values (r.b_id, vin, models[n], 4290000, 'In Stock');
    elsif r.b_kind = 'LOAN' then
      insert into loan_chassis (loan_id, chassis_no, car_model, cost, status)
        values (r.b_id, vin, models[n], 4290000, 'Active');
    else
      update promissory_notes
         set chassis_list = coalesce(chassis_list, '[]'::jsonb)
             || jsonb_build_object('chassis_no', vin, 'model', models[n], 'amount', 4290000)
       where id = r.b_id;
    end if;
  end loop;

  raise notice 'สร้างแล้ว — ต่างธนาคาร % คู่ · ธนาคารเดียวกัน % คู่', made_cross, made_same;
  if made_cross < 3 or made_same < 2 then
    raise notice 'ได้ไม่ครบ 5 — สัญญาที่ยังไม่ปิดในระบบมีไม่พอ หรือธนาคารไม่หลากหลายพอ';
  end if;
end $$;

-- ── ตรวจผล ──
with uses as (
  select chassis_no, 'Floor Plan' as m, f.fp_no as no, f.finance_institution as bank
  from fp_chassis c join floor_plans f on f.id = c.fp_id where c.chassis_no like 'DEMO-%'
  union all
  select c.chassis_no, 'Loan', l.loan_no, l.finance_institution
  from loan_chassis c join loans l on l.id = c.loan_id where c.chassis_no like 'DEMO-%'
  union all
  select x->>'chassis_no', 'P/N', p.pn_number, p.finance_institution
  from promissory_notes p, jsonb_array_elements(coalesce(p.chassis_list,'[]'::jsonb)) x
  where x->>'chassis_no' like 'DEMO-%'
)
select chassis_no as เลขตัวถัง,
       count(*) as จำนวนสัญญา,
       count(distinct bank) as จำนวนธนาคาร,
       case when count(distinct bank) = 1 then 'ธนาคารเดียวกัน (ผิดกฎ)' else 'ต่างธนาคาร (ตรวจสอบ)' end as ผลตรวจ,
       string_agg(m || ' ' || coalesce(no,'-') || ' · ' || coalesce(bank,'-'), '  |  ') as รายละเอียด
from uses group by 1 order by 3, 1;
