-- 0081: FP Chassis — วันที่รถถูกขาย (FR-FP-022 · Comment FP #1)
-- เมื่อรถใน Floor Plan ถูกขายที่ NetSuite → บันทึก sold_date เพื่อ:
--   1) แจ้งเตือน Finance/Accounting ว่าต้องปิด FP + จ่ายคืนธนาคาร (Notification center)
--   2) แสดงใน Chassis Movement Report (รถขายแล้วแต่ FP ยังไม่ปิด)
alter table fp_chassis
  add column if not exists sold_date date,
  add column if not exists sold_source text default 'manual'
    check (sold_source in ('netsuite', 'manual'));

comment on column fp_chassis.sold_date is 'วันที่รถถูกขาย (จาก NetSuite หรือกรอกเอง) — trigger แจ้งเตือนปิด FP';
comment on column fp_chassis.sold_source is 'ที่มาของข้อมูลการขาย: netsuite = สัญญาณจาก NetSuite · manual = กรอกเอง';
