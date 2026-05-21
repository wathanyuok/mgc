-- =====================================================================
--  Curtailment master — expand 3 → 6 tiers
--  MoM ไม่ได้กำหนดตัวเลข milestone ตายตัว (90/180/270 เดิมเป็นแค่ default)
--  ตัวเลขจริงมาจากสัญญา dealer ของธนาคาร เช่น BMW Floor Plan:
--    New/Demo/SLC : 210(10%) · 270(10%) · 360(20%) · 450(20%) · 540(40%)  → 5 งวด
--    Used         : 120(10%) · 210(10%) · 270(10%) · 360(20%) · 450(20%) · 540(30%) → 6 งวด
--  จึงต้องรองรับได้ถึง 6 tier (เดิมมีแค่ tier1-3)
-- =====================================================================
alter table curtailment add column if not exists tier4_days integer;
alter table curtailment add column if not exists tier4_pct  numeric(6,2);
alter table curtailment add column if not exists tier5_days integer;
alter table curtailment add column if not exists tier5_pct  numeric(6,2);
alter table curtailment add column if not exists tier6_days integer;
alter table curtailment add column if not exists tier6_pct  numeric(6,2);
