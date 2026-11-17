-- 0146: Freeze schedule ตอนปิดสัญญา/ต่อสัญญา — เก็บ snapshot ของตารางผ่อน ณ วันปิด
-- ปัญหา: หน้า detail คำนวณตารางผ่อนสด (recompute) จาก params ปัจจุบันเสมอ
--   ถ้าหลังปิดสัญญามีการแก้ค่า (เช่น Roll Over เอา balloon ออก) ตารางจะเพี้ยนจาก JE ที่ลงบัญชีไปแล้ว
--   → สัญญา Closed/Roll Over โชว์ยอดไม่ตรงกับ JE ทำให้คนตรวจสับสน (ตัวเลขบัญชีถูก แต่การแสดงผลเพี้ยน)
-- แก้: ตอนปิด/ต่อสัญญา เก็บผลลัพธ์ตารางผ่อน (HPScheduleResult) ลง schedule_snapshot
--   หน้า detail: ถ้าสัญญาปิดแล้ว + มี snapshot → อ่านจาก snapshot แทน recompute → ตรง JE เสมอ
-- Idempotent — รันซ้ำได้
ALTER TABLE leases ADD COLUMN IF NOT EXISTS schedule_snapshot jsonb;

COMMENT ON COLUMN leases.schedule_snapshot IS
  'Snapshot ตารางผ่อน (HPScheduleResult) ณ วันปิด/ต่อสัญญา — freeze ให้ตรง JE · null = ยังไม่ปิด (คำนวณสด)';
