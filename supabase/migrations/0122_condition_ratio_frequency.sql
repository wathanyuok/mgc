-- ============================================================
-- 0122 — Covenant Trigger: Frequency + ตัวเลขตั้งต้นที่ดึงจาก NetSuite
--
--   ตาม MoM 30 ก.ย. 2026 (เช้า บ.341/439): แจ้งเตือน "รายเดือน" จากการคำนวณ
--   อัตราส่วนทางการเงิน → เพิ่มช่องกำหนดความถี่ (เบื้องต้น = monthly)
--   และเก็บตัวเลขตั้งต้นที่ดึงมา (หนี้สินรวม/ส่วนของผู้ถือหุ้น/EBITDA/ภาระชำระหนี้)
--   เพื่อให้ตรวจสอบย้อนได้ว่าอัตราส่วนคำนวณมาจากอะไร
--
--     ratios_frequency  monthly | quarterly | yearly   (default monthly)
--     ratios_inputs     jsonb — { totalLiabilities, totalEquity, netOperatingIncome, debtService }
--
--   รันซ้ำได้ (idempotent)
-- ============================================================

alter table ma_conditions add column if not exists ratios_frequency text not null default 'monthly';
alter table ma_conditions add column if not exists ratios_inputs    jsonb;

alter table ca_conditions add column if not exists ratios_frequency text not null default 'monthly';
alter table ca_conditions add column if not exists ratios_inputs    jsonb;
