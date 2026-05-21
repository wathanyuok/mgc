-- =====================================================================
--  Loan Step-Up / Step-Down payment — MoM Day3 §3
--  "ค่างวดเพิ่ม/ลดเป็นช่วง เช่น 12 งวดแรกที่ 35,000 และงวด 13 เป็นต้นไปเพิ่มเป็น 50,000"
--  เก็บจุดเปลี่ยน (step_period) + ยอด RV ที่ปลายเฟส 1 (step_residual)
--  ค่างวดเฟส 1 amortize ลงเหลือ step_residual แล้วเฟส 2 amortize ลงเหลือ residual_value
-- =====================================================================
alter table loans add column if not exists step_period   integer;
alter table loans add column if not exists step_residual  numeric(15,2);
