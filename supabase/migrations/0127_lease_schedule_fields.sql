-- =====================================================================
-- 0127: HP/Lease — เพิ่ม field ตารางคำนวณให้เหมือน Loan
--   payment_timing = 'arrears' (ปลายงวด) | 'advance' (ต้นงวด)
--   step_phases    = [{ fromPeriod, installment }] — Step Payment หลายช่วง
-- =====================================================================
alter table leases add column if not exists payment_timing text not null default 'arrears';
alter table leases add column if not exists step_phases    jsonb;
