-- =====================================================================
-- 0120 — Bank Statement: เพิ่มยอดยกมา (opening_balance)
--   ใช้เป็นฐานคำนวณ running balance ของบรรทัดแรก (เดิมบรรทัดแรกต้องกรอก balance เอง)
--   Balance แต่ละบรรทัด (Manual) = ยอดก่อนหน้า + Credit − Debit · บรรทัดแรกใช้ opening_balance
-- =====================================================================
alter table bank_statements add column if not exists opening_balance numeric(18,2) not null default 0;

comment on column bank_statements.opening_balance is 'ยอดยกมาต้นงวด — ฐานคำนวณ running balance ของบรรทัดแรก';
