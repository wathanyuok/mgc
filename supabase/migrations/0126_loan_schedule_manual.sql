-- =====================================================================
-- 0126: Loan — แก้ตารางงวดรายงวดเอง (match ธนาคารเป๊ะ · เคส Fix Principle ฯลฯ)
--   schedule_manual    = true → ใช้ตารางที่ผู้ใช้แก้ (ไม่คำนวณทับ)
--   schedule_overrides = [{ period, principal, interest }] เฉพาะงวดที่พิมพ์ทับ
--     ระบบคำนวณ installment (=ต้น+ดอก) + ยอดคงเหลือ ให้อัตโนมัติจากต้น/ดอกที่กรอก
-- =====================================================================
alter table loans add column if not exists schedule_manual    boolean not null default false;
alter table loans add column if not exists schedule_overrides  jsonb   not null default '[]'::jsonb;
