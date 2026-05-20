-- =====================================================================
--  Chassis — Engine No. (เลขเครื่อง) per MoM Day3 §3 (Floor Plan / Chassis Data)
--  Fields to capture/display: Chassis No., Engine No., Model, Value
-- =====================================================================
alter table fp_chassis add column if not exists engine_no text;
alter table loan_chassis add column if not exists engine_no text;
