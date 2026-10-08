-- วินิจฉัยว่าทำไม MGC-LO-2026-1008 ไม่ปิด — เทียบ paid กับ due + เช็กตารางงวด
select
  l.lease_no,
  l.mode,
  l.status,
  l.id as lease_id,
  -- ยอดจ่ายสะสม (ไม่รวม VAT) จากใบตัดชำระที่ Posted
  (select coalesce(sum(rl.amount),0)
     from repayment_lines rl join repayments r on r.id = rl.repayment_id
    where rl.facility_id = l.id and r.status = 'Posted')                       as paid_ex_vat,
  -- จำนวนแถวตารางงวดกลางของสัญญานี้ (0 = ไม่มีตาราง → auto-close ข้าม)
  (select count(*) from installment_schedules s where s.facility_id = l.id)     as sched_rows,
  -- due แบบรวม VAT (payment ดิบ)
  (select coalesce(sum(coalesce(s.payment,0)),0)
     from installment_schedules s where s.facility_id = l.id)                   as due_inc_vat,
  -- due แบบไม่รวม VAT (payment - vat) = เป้าที่ auto-close ใช้
  (select coalesce(sum(coalesce(s.payment,0)-coalesce(s.vat,0)),0)
     from installment_schedules s where s.facility_id = l.id)                   as due_ex_vat,
  -- รวม VAT ในตาราง (ถ้า 0 แต่ due_inc_vat ใหญ่ = payment รวม VAT แต่ไม่ได้แยกช่อง vat)
  (select coalesce(sum(coalesce(s.vat,0)),0)
     from installment_schedules s where s.facility_id = l.id)                   as sched_vat_total
from leases l
where l.lease_no = 'MGC-LO-2026-1008';

-- ดูรายแถวตารางงวด (ถ้ามี)
select s.period, s.principal, s.interest, s.vat, s.payment, s.paid, s.due_date
from installment_schedules s
join leases l on l.id = s.facility_id
where l.lease_no = 'MGC-LO-2026-1008'
order by s.period;
