-- =====================================================================
-- 0136: Lease / HP — แก้ตารางคำนวณเอง (Schedule Calculate) ให้ตรงใบธนาคาร
--   MoM 09 ต.ค. 2026: "ค่างวดต่อเดือน เปิดให้แก้ไขได้กรณีไม่ตรงกับธนาคาร รวมถึง Effective"
--
--   schedule_manual    = เปิดโหมดแก้ตาราง
--   schedule_overrides = [{ period, field, value }] ช่องที่พิมพ์ทับรายงวด
--     field = installment | payment | interest | principal | endBalance |
--             vat | totalIncVat | deferredInterestBalance | vatBalance
--   ใช้ได้ทั้ง HP / Leasing / Lease Other (แท็บ Schedule Calculate เดียวกัน)
-- =====================================================================
alter table leases add column if not exists schedule_manual    boolean not null default false;
alter table leases add column if not exists schedule_overrides  jsonb   not null default '[]'::jsonb;
