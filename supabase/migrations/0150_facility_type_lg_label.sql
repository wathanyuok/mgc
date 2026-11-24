-- 0150: ชื่อ + ลำดับ FACILITY TYPE (dropdown) ให้ตรงกับเมนูด้านซ้าย (เลิกใช้ตัวย่อ)
--   dropdown อ่าน name_en + เรียงตาม sort_order · เดิมเป็นตัวย่อ (P/N, O/D ...) และลำดับไม่ตรงเมนู
--   ลำดับเมนูซ้าย: Promissory Note · Letter/Bank Guarantee · Letter of Credit · Floor Plan ·
--                 Overdraft · Trust Receipt · FX Forward Rate · Loan · Hire Purchase · Leasing
--   SBLC ไม่มีเมนูซ้าย (เป็นชนิดย่อยของ LC) → วางต่อจาก LC
-- Idempotent — รันซ้ำได้
update facility_types set name_en = 'Promissory Note',         sort_order = 1  where code = 'PN';
update facility_types set name_en = 'Letter / Bank Guarantee', sort_order = 2  where code = 'LG';
update facility_types set name_en = 'Letter of Credit',        sort_order = 3  where code = 'LC';
update facility_types set name_en = 'SBLC (Standby LC)',       sort_order = 4  where code = 'SBLC';
update facility_types set name_en = 'Floor Plan',              sort_order = 5  where code = 'FP';
update facility_types set name_en = 'Overdraft',              sort_order = 6  where code = 'OD';
update facility_types set name_en = 'Trust Receipt',           sort_order = 7  where code = 'TR';
update facility_types set name_en = 'FX Forward Rate',         sort_order = 8  where code = 'FXF';
update facility_types set name_en = 'Loan',                    sort_order = 9  where code = 'LOAN';
update facility_types set name_en = 'Hire Purchase',           sort_order = 10 where code = 'HP';
update facility_types set name_en = 'Leasing',                 sort_order = 11 where code = 'LEASE';
