-- 0098 — แก้ตัวย่อที่พิมพ์ผิด SDLC → SBLC
--
-- ประเภทหนังสือค้ำประกันมี 3 แบบ: B/G · L/G · Standby L/C
-- ตัวย่อมาตรฐานของแบบที่ 3 คือ SBLC (Standby Letter of Credit)
-- แต่ในระบบพิมพ์เป็น SDLC ทั้งในตัวเลือกบนหน้าจอและข้อมูลที่บันทึกไปแล้ว
--
-- โมดูล Letter of Credit ก็ใช้ SBLC อยู่แล้ว จึงแก้ให้ตรงกันทั้งระบบ

update letter_guarantees
   set lg_type = 'SBLC'
 where lg_type = 'SDLC';

comment on column letter_guarantees.lg_type is
  'ประเภทหนังสือค้ำประกัน — B/G (Bank Guarantee) · L/G (Letter of Guarantee) · SBLC (Standby Letter of Credit)';

-- ค่าตั้งต้นเดิมของคอลัมน์คือ 'LG' ซึ่งไม่ตรงกับตัวเลือกใดบนหน้าจอเลย
-- (ตัวเลือกจริงคือ 'B/G' · 'L/G' · 'SBLC') ทำให้แถวที่สร้างโดยไม่ระบุประเภท
-- จะได้ค่าที่ dropdown แสดงไม่ออก — ปรับให้ตรงกับค่าตั้งต้นบนหน้าจอคือ B/G
alter table letter_guarantees alter column lg_type set default 'B/G';

update letter_guarantees set lg_type = 'L/G' where lg_type = 'LG';
update letter_guarantees set lg_type = 'B/G' where lg_type = 'BG';
