-- INSTALLMENT AMOUNT — ค่างวดตายตัวที่ผู้ใช้กำหนดเอง (Leasing / Leasing Other)
--
-- PRINCIPAL ยังเป็นยอดตั้งต้น (= NPV ที่ทีมบัญชีคำนวณจาก Excel ตาม MoM §4.2) เหมือนเดิม
-- ช่องนี้แค่ "กำหนดค่างวดต่อหนึ่งงวด" ตายตัว แทนที่จะให้ระบบคำนวณค่างวดจากเงินต้น
-- ระบบ amortize จากค่างวดนี้: ดอกเบี้ย = ยอดคงเหลือ × อัตรา · ตัดต้น = ค่างวด − ดอกเบี้ย
-- ไม่คำนวณ NPV เอง (ไม่ขัด MoM — ระบบไม่มีตัวคำนวณ NPV/EIR)
--
-- ว่าง/0 = ให้ระบบคำนวณค่างวดจากเงินต้นแบบเดิม (PMT)

alter table leases add column if not exists installment_amount numeric(20, 2);

comment on column leases.installment_amount is
  'ค่างวดตายตัวที่กำหนดเอง (ต่อหนึ่งงวด) · ว่าง/0 = ให้ระบบคำนวณค่างวดจากเงินต้น (PMT) · PRINCIPAL ยังเป็นยอดตั้งต้นเสมอ';
