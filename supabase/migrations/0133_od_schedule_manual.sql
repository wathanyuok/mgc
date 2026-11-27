-- =====================================================================
-- 0133: Overdraft (OD) — แก้ตารางคำนวณดอกเบี้ยรายวันเอง
--   schedule_manual    = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ date, interest }] วันที่พิมพ์ทับ
--   OD อิงยอดเดินบัญชีจริง (Ending Balance) จึงเปิดแก้ได้แค่ "ดอกเบี้ยต่อวัน"
--     ให้ตรงกับดอก O/D ที่ธนาคารคิดจริง (เผื่อ day-count / เรทเปลี่ยนกลางเดือน / value date ต่างกัน)
--   override อ้างอิงด้วย "วันที่" (ไม่ใช่งวด) เพราะ OD คิดดอกรายวัน
-- =====================================================================
alter table overdrafts add column if not exists schedule_manual boolean not null default false;
alter table overdrafts add column if not exists schedule_overrides jsonb not null default '[]'::jsonb;
