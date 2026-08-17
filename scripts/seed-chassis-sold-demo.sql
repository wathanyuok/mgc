-- ข้อมูลตัวอย่างสำหรับรายงาน "Chassis Movement" (รถขายแล้ว) — ครบทุกสถานะ Floor Plan
--
-- สร้าง Floor Plan สาธิต 7 ใบ ใบละ 1 สถานะ พร้อมรถที่บันทึกวันขายไว้แล้วใบละ 1 คัน
-- เพื่อให้เห็นบนหน้าจอว่าแต่ละสถานะแสดงผลต่างกันอย่างไร:
--   Draft / Approved / Active / Roll Over → ยังไม่ปิด (แถวเหลือง · ป้ายส้ม · นับใน "ค้างปิด")
--   Closed / Repaid / Cancelled           → ปิดแล้ว   (แถวขาว · ป้ายเทา · ไม่นับ)
--
-- รันซ้ำได้ — ลบชุดสาธิตเดิมทิ้งก่อนทุกครั้ง (Floor Plan ที่ fp_no ขึ้นต้น DEMO-FP-)

do $$
declare
  v_ca      uuid;
  v_bank    text;
  v_fp      uuid;
  i         int := 0;
  statuses  text[] := array['Draft','Approved','Active','Roll Over','Closed','Repaid','Cancelled'];
  models    text[] := array[
    'BMW X7 xDrive40d','BMW 530e M Sport','MINI Cooper S 5DR',
    'Audi A6 45 TFSI','BMW X5 xDrive40i','BMW 320i M Sport','Honda Civic RS'
  ];
  sources   text[] := array['netsuite','manual','netsuite','manual','netsuite','manual','netsuite'];
begin
  -- ── ล้างชุดสาธิตเดิม (ลบ Floor Plan แล้วรถในนั้นหายตามอัตโนมัติ) ──
  delete from floor_plans where fp_no like 'DEMO-FP-%';

  -- ── หยิบวงเงินและธนาคารที่มีอยู่จริงมาใช้อ้างอิง ──
  select id, finance_institution into v_ca, v_bank
  from credit_agreements order by created_at limit 1;

  if v_bank is null then
    select finance_institution into v_bank from floor_plans limit 1;
  end if;
  v_bank := coalesce(v_bank, 'KBANK');

  -- ── สร้าง Floor Plan ใบละสถานะ พร้อมรถขายแล้ว 1 คัน ──
  for i in 1 .. array_length(statuses, 1) loop
    insert into floor_plans (
      fp_no, name, ca_id, finance_institution, vendor, schedule_mode,
      start_date, transaction_date, maturity_date, end_date,
      total_amount, amount, used_amount, currency, status, remark
    ) values (
      'DEMO-FP-' || lpad(i::text, 2, '0'),
      'ตัวอย่าง — สถานะ ' || statuses[i],
      v_ca, v_bank, 'BMW Thailand', 'bmw',
      current_date - 120, current_date - 120, current_date + 60, current_date + 60,
      10000000, 10000000, 5000000, 'THB',
      statuses[i]::fp_status,
      'ข้อมูลสาธิต — ลบได้'
    )
    returning id into v_fp;

    insert into fp_chassis (
      fp_id, chassis_no, model, receive_date, amount, status, sold_date, sold_source, sort_order
    ) values (
      v_fp,
      'DEMO-SOLD-' || lpad(i::text, 4, '0'),
      models[i],
      current_date - 100,
      3000000 + (i * 250000),
      'Sold',
      current_date - (i * 6),          -- ทยอยขายห่างกัน 6 วัน
      sources[i],
      i
    );
  end loop;

  raise notice 'สร้าง Floor Plan สาธิต % ใบ พร้อมรถขายแล้วใบละ 1 คัน', array_length(statuses, 1);
end $$;

-- ── ตรวจผล ──
select f.fp_no          as floor_plan,
       f.status::text   as สถานะ_fp,
       case when f.status::text in ('Closed','Repaid','Cancelled')
            then 'ปิดแล้ว → แถวขาว · ไม่นับค้างปิด'
            else 'ยังไม่ปิด → แถวเหลือง · นับค้างปิด' end as ที่ควรเห็นบนหน้าจอ,
       c.chassis_no     as เลขตัวถัง,
       c.model          as รุ่นรถ,
       c.sold_date      as วันขาย,
       c.sold_source    as ที่มา,
       c.amount         as ยอดเบิกคงค้าง
from floor_plans f
join fp_chassis c on c.fp_id = f.id
where f.fp_no like 'DEMO-FP-%'
order by f.fp_no;

-- ── ลบชุดสาธิตทิ้ง ──
-- delete from floor_plans where fp_no like 'DEMO-FP-%';
