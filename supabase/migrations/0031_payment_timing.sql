-- =====================================================================
--  Payment timing — ชำระต้นงวด (advance / annuity-due) vs ปลายงวด (arrears / ordinary)
--  MoM Day4 §5.2: ปกติจ่ายสิ้นงวด (arrears); กรณีจ่ายล่วงหน้า = ต้นงวด (advance)
--  Default = 'arrears' (ปลายงวด) — ไม่กระทบสัญญาเดิม
-- =====================================================================
alter table loans  add column if not exists payment_timing text not null default 'arrears';
alter table leases add column if not exists payment_timing text not null default 'arrears';
