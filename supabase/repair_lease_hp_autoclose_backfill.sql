-- ============================================================
-- Repair: ปิดสัญญา HP / Leasing / Lease Other ที่ "จ่ายครบแล้ว" แต่สถานะยังค้าง Active
--
--   เหตุ: ใบ Repayment ที่ Posted ไปก่อนหน้า (ก่อนแก้ payoff เทียบยอดแบบไม่รวม VAT)
--         auto-close ไม่ทำงาน เพราะเดิมเทียบ "จ่าย (ไม่รวม VAT)" กับ "เป้า (รวม VAT)"
--
--   หลักการ (ตรงกับ RepaymentDetail.tsx หลังแก้):
--     paid   = Σ repayment_lines.amount  (เฉพาะใบ Posted)            ← ไม่รวม VAT
--     due    = Σ (installment_schedules.payment − vat)               ← หัก VAT ออก
--     ปิดเมื่อ paid ≥ due − 0.01  และสัญญายัง Active
--
--   ครอบคลุม mode = hp / lease / other (ทุกชนิดสัญญาเช่า)
--   รันซ้ำได้ (idempotent) · ไม่กระทบสัญญาที่ปิดไปแล้ว
-- ============================================================

with paid as (
  select rl.facility_id, sum(rl.amount) as amt
  from repayment_lines rl
  join repayments r on r.id = rl.repayment_id
  where r.status = 'Posted'
    and rl.facility_id is not null
  group by rl.facility_id
),
due as (
  select facility_id,
         sum(coalesce(payment, 0) - coalesce(vat, 0)) as due_amt
  from installment_schedules
  group by facility_id
)
update leases l
set status = 'Closed'
from paid p
join due d on d.facility_id = p.facility_id
where l.id = p.facility_id
  and l.status = 'Active'
  and d.due_amt > 0
  and p.amt >= d.due_amt - 0.01;

-- ตรวจผล — รายการที่ถูกปิดจากสคริปต์นี้ (และยอดเทียบ)
select l.lease_no, l.mode, l.status,
       (select coalesce(sum(rl.amount),0)
          from repayment_lines rl join repayments r on r.id = rl.repayment_id
         where rl.facility_id = l.id and r.status = 'Posted') as paid_ex_vat,
       (select coalesce(sum(coalesce(payment,0) - coalesce(vat,0)),0)
          from installment_schedules s where s.facility_id = l.id) as due_ex_vat
from leases l
where l.lease_no = 'MGC-HP-2026-1008'
   or l.mode in ('hp','lease','other')
order by l.updated_at desc nulls last, l.lease_no
limit 50;
