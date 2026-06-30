-- 0053_lc_close_rate.sql
-- Feature B2 — LC Close Rate Dropdown (Workshop decision: Day4 §13 / FX Forward + LC linkage)
--
-- Context:
--   เมื่อปิด/จ่าย LC, ทีมบัญชีต้องระบุว่าใช้อัตราแลกเปลี่ยนใด:
--     1) "Spot Rate"        — อัตรา ณ วันปิด (เช่น NetSuite daily rate)
--     2) "FX Contract Rate" — อัตราจาก FX Forward Contract ที่ผูกไว้กับ LC
--                             (ดึงจาก fx_forwards.forward_rate ของ reference_fxf_id)
--
-- Workshop note:
--   MoM Day4 §13 — LC ที่ Hedge ด้วย FX Forward Contract: เมื่อตัด LC ปลายทาง
--   ให้ใช้ rate ของ FX Forward Contract (ไม่ใช่ spot ตลาด) เพื่อให้ FX gain/loss
--   เป็นไปตามที่บริษัทป้องกันความเสี่ยงไว้
--
-- Existing column `settlement_fx_rate` (numeric 12,6) ใช้บันทึก rate ที่ Pay & Close
-- จริงๆ. คอลัมน์ใหม่นี้แค่ระบุ "source ของ rate" (Spot vs FXF Contract) — เพื่อ audit
-- และเพื่อให้ UI auto-fill ได้ถูกต้อง

ALTER TABLE letters_of_credit
  ADD COLUMN IF NOT EXISTS close_rate_type varchar(20),
  ADD COLUMN IF NOT EXISTS close_rate      numeric(12,4);

COMMENT ON COLUMN letters_of_credit.close_rate_type IS
  'Workshop B2 — ที่มาของอัตราตอนปิด LC: ''spot'' (ตลาด/NetSuite ณ วันปิด) | ''fx_contract'' (จาก FX Forward Contract ที่ผูกไว้ใน reference_fxf_id) | NULL (ยังไม่ปิด/ไม่ระบุ)';

COMMENT ON COLUMN letters_of_credit.close_rate IS
  'Workshop B2 — อัตราจริงที่ใช้ตอนปิด LC. ถ้า close_rate_type=fx_contract จะถูก auto-fill จาก fx_forwards.forward_rate ของ reference_fxf_id';
