-- ตรวจว่าตอนนี้มีรถค้ำประกันซ้ำวงเงินอยู่จริงไหม
-- รันใน Supabase → SQL Editor แล้วดูผลทีละส่วน

-- ① มีข้อมูลรถผูกสัญญาอยู่กี่รายการ (ถ้าเป็น 0 หมด = ยังไม่มีใครผูกรถเลย รายงานจึงว่าง)
select 'leases (HP/Lease)' as source, count(*) from leases where chassis_no is not null
union all select 'loan_chassis',  count(*) from loan_chassis
union all select 'fp_chassis',    count(*) from fp_chassis
union all select 'promissory_notes (มีรายการรถ)', count(*) from promissory_notes
  where jsonb_array_length(coalesce(chassis_list, '[]'::jsonb)) > 0;

-- ② รวมทุกโมดูล แล้วนับว่าเลขตัวถังไหนอยู่มากกว่า 1 สัญญา
with uses as (
  select chassis_no, 'HP/Lease' as module, lease_no as contract_no, status::text as status
  from leases where chassis_no is not null
  union all
  select c.chassis_no, 'Loan', l.loan_no, l.status::text
  from loan_chassis c join loans l on l.id = c.loan_id
  union all
  select c.chassis_no, 'Floor Plan', f.fp_no, f.status::text
  from fp_chassis c join floor_plans f on f.id = c.fp_id
  union all
  select x->>'chassis_no', 'P/N', p.pn_number, p.status::text
  from promissory_notes p, jsonb_array_elements(coalesce(p.chassis_list, '[]'::jsonb)) x
  where x->>'chassis_no' is not null
)
select chassis_no,
       count(*) as จำนวนสัญญา,
       string_agg(module || ' ' || coalesce(contract_no,'-') || ' (' || status || ')', ' · ') as รายละเอียด
from uses
group by chassis_no
having count(*) > 1
order by count(*) desc;

-- ③ ถ้า ② มีผลแต่รายงานยังว่าง = สถานะสัญญาไม่อยู่ในกลุ่ม "ยังไม่ปิด"
--    ดูว่าสถานะจริงในระบบมีค่าอะไรบ้าง
select 'leases' as t, status::text, count(*) from leases group by 2
union all select 'loans', status::text, count(*) from loans group by 2
union all select 'floor_plans', status::text, count(*) from floor_plans group by 2
union all select 'promissory_notes', status::text, count(*) from promissory_notes group by 2
order by 1, 2;
