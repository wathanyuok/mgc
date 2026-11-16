-- =====================================================================
-- 0140 — HP Interest Basis (วิธีคิดดอกเบี้ย)
-- MoM 09/10/2026: HP ธนาคารส่วนใหญ่คิดดอกแบบ Monthly (÷12 flat)
--   แต่ระบบเดิมคิด Daily (actual/365) → ผลไม่ตรงกับธนาคาร
--   เพิ่มตัวเลือกให้เลือกได้ · default 'Monthly'
--     'Monthly' = ยอดคงเหลือ × rate ÷ 12 (× เดือนต่องวด) · flat
--     'Daily'   = actual/365 ตามจำนวนวันจริงในงวด (พฤติกรรมเดิม)
-- =====================================================================
alter table leases add column if not exists interest_basis text default 'Monthly';

-- ของเดิมที่ยังไม่มีค่า → ตั้งเป็น Monthly (ตาม default ที่ HP ธนาคารใช้)
update leases set interest_basis = 'Monthly' where interest_basis is null;
