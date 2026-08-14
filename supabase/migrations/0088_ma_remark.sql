-- 0088: เพิ่ม remark ให้ master_agreements (ใช้เก็บเหตุผลส่งกลับแก้/ปฏิเสธ จาก Approval Flow)
-- ตารางอื่น (CA + TX ทั้งหมด) มี remark อยู่แล้ว — MA เป็นตารางเดียวที่ขาด
alter table master_agreements add column if not exists remark text;
