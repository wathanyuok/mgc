-- ============================================================
-- เติมสถาบันการเงิน (finance_institution) ให้ CA ที่เว้นว่าง
--   ดึงค่าจาก Master Agreement แม่มาเติมให้ (CA ควร inherit จาก MA อยู่แล้ว)
--   หลังรัน → แถว "—" ในการ์ด "ภาพรวมวงเงิน" บน Dashboard จะหายไป
--   รันซ้ำได้ (idempotent)
-- ============================================================

-- ① ดูก่อนว่ามี CA ใบไหนบ้างที่ว่าง + MA แม่มีแบงก์อะไร
select ca.id, ca.ca_name, ca.contract_number,
       ca.finance_institution as ca_bank_now,
       ma.finance_institution as ma_bank,
       ca.credit_line, ca.status
from credit_agreements ca
left join master_agreements ma on ma.id = ca.ma_id
where ca.finance_institution is null or trim(ca.finance_institution) = '';

-- ② เติมค่าจาก MA แม่
update credit_agreements ca
set finance_institution = ma.finance_institution
from master_agreements ma
where ca.ma_id = ma.id
  and (ca.finance_institution is null or trim(ca.finance_institution) = '')
  and ma.finance_institution is not null
  and trim(ma.finance_institution) <> '';

-- ③ ตรวจผล — ควรเหลือ 0 แถว · ถ้ายังเหลือ = MA แม่ก็ไม่มีแบงก์ (ต้องไปเติมที่ MA ก่อน
--    หรือ CA ใบนั้นไม่มี ma_id) → แก้รายใบในหน้าจอ
select ca.id, ca.ca_name, ca.contract_number, ca.ma_id, ca.credit_line
from credit_agreements ca
where ca.finance_institution is null or trim(ca.finance_institution) = '';
