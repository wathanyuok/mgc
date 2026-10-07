-- =====================================================================
-- 0118 — O/D: 1 เลขบัญชี = 1 O/D ที่ยังมีผล (Active/ยังไม่ปิด)
--   O/D คิดดอกเบี้ยจากรายการเดินบัญชีของ account_no · ถ้า 2 ฉบับที่ยังเปิดใช้เลขเดียวกัน
--   ดอกเบี้ยจะถูกนับซ้ำ → ห้ามที่ระดับ DB (เสริมจากการบล็อกในแอป)
--   ฉบับที่ปิดแล้ว (Closed/Cancelled) ไม่นับ — รองรับต่ออายุ/Rollover บนบัญชีเดิม
--
--   *** ถ้ามีข้อมูลเดิมที่ account_no ซ้ำกันอยู่ในสถานะยังเปิด การสร้าง index นี้จะล้มเหลว ***
--   *** ให้ปิด/ยกเลิกฉบับที่ซ้ำ หรือเปลี่ยน account_no ก่อน แล้วค่อยรัน migration นี้ ***
-- =====================================================================
create unique index if not exists uq_overdrafts_account_active
  on overdrafts (account_no)
  where account_no is not null
    and status not in ('Cancelled', 'Closed');

comment on index uq_overdrafts_account_active is
  '1 เลขบัญชี = 1 O/D ที่ยังมีผล (ไม่นับ Closed/Cancelled) · กันดอกเบี้ยนับซ้ำ · MoM OD-35';
