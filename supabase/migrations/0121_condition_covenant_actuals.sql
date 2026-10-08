-- ============================================================
-- 0121 — Condition / Covenant Trigger (M0 + M1)
--
--   ตาม MoM 30 ก.ย. 2026 (เช้า บ.341/367/411/415/417): ช่อง Condition (D/E, DSCR)
--   เปลี่ยนจาก "Information เฉยๆ" เป็นค่าเกณฑ์ Trigger · ระบบต้องดึงอัตราส่วนจริง
--   จาก NetSuite (Connected Service) มาเทียบรายเดือน → ถ้าผิดเงื่อนไข (Breach) แจ้งเตือน
--   ทั้งระดับ M0 (Master Agreement) และ M1 (Credit Agreement)
--
--   เก็บค่าที่ดึงมาล่าสุดไว้ในตาราง condition เพื่อให้หน้าแจ้งเตือนคำนวณ breach ได้
--     de_actual        อัตราส่วน D/E จริง (ดึงจาก NetSuite)
--     dscr_actual      อัตราส่วน DSCR จริง (ดึงจาก NetSuite)
--     ratios_fetched_at เวลาที่ดึงล่าสุด
--     ratios_source    แหล่งที่มา (เช่น 'NetSuite')  — ยังเป็น mock รอเชื่อม API จริง
--
--   รันซ้ำได้ (idempotent)
-- ============================================================

alter table ma_conditions add column if not exists de_actual        numeric(18,4);
alter table ma_conditions add column if not exists dscr_actual      numeric(18,4);
alter table ma_conditions add column if not exists ratios_fetched_at timestamptz;
alter table ma_conditions add column if not exists ratios_source    text;

alter table ca_conditions add column if not exists de_actual        numeric(18,4);
alter table ca_conditions add column if not exists dscr_actual      numeric(18,4);
alter table ca_conditions add column if not exists ratios_fetched_at timestamptz;
alter table ca_conditions add column if not exists ratios_source    text;
