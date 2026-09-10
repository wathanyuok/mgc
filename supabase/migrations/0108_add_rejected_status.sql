-- Migration 0108 — unify การปฏิเสธเป็น 'Rejected' ทุกโมดูล
--
-- เดิมฝั่งธุรกรรมปฏิเสธ → 'Cancelled' · ปรับให้ปฏิเสธ → 'Rejected' เหมือน MA/CA
-- (Cancelled สงวนไว้สำหรับ "Maker ยกเลิกฉบับร่างเอง" — migration 0109/โค้ด)
--
-- เพิ่มค่า enum 'Rejected' ให้ทุก status type ที่ยังไม่มี (loan_status มีแล้ว)
-- หมายเหตุ: ALTER TYPE ADD VALUE รันเป็น statement แยก · ถ้า SQL editor ติด transaction block
-- ให้รันทีละบรรทัด

ALTER TYPE pn_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE lg_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE lc_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE fp_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE od_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE tr_status    ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE fxf_status   ADD VALUE IF NOT EXISTS 'Rejected';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'Rejected';
