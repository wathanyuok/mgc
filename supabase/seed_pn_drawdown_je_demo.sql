-- =====================================================================
-- Seed: P/N — ทดสอบ "ลงบัญชีวันเบิกเงิน" (Post Drawdown JE ครั้งเดียว)
-- =====================================================================
-- สร้าง P/N สถานะ Approved พร้อมกดลงบัญชีวันเบิกเงิน · ไม่ผูก acct_cards
-- เพื่อดูว่าใบสำคัญใช้บัญชี default:
--     Dr  1001201 เงินสด/ธนาคาร (C/A-BBL)
--     Cr  2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน
--
-- ── วิธีทดสอบ (ล็อกอินด้วยบัญชีที่มีสิทธิ์ pn.approve เช่น Admin) ──────
--   1) เปิด Promissory Note → PN-DEMO-DRAW
--   2) กดปุ่ม 📋 ลงบัญชีวันเบิกเงิน (แถวปุ่มบนสุด)
--        → ระบบสร้าง JE + เปลี่ยนสถานะเป็น Active
--   3) เมนูซ้าย Journal Entries → เปิดใบของ P/N นี้
--        → เห็น Dr 1001201 / Cr 2142101 ยอด 1,000,000
--   ทางเลือก: ถ้าอยากทดสอบบัญชีที่ผูกเอง → ไปแท็บ Accounting เลือกบัญชี
--             (dropdown เหลือ 4 บทบาท: Cash / Note Payable / Interest / Accrued)
--             แล้ว Save ก่อนกดลงบัญชี → JE จะใช้รหัสที่ผูกแทน default
--
-- รันซ้ำได้ (ลบ JE + PN เดิมก่อน)
-- =====================================================================

delete from journal_entries
 where source_id in (select id from promissory_notes where pn_number = 'PN-DEMO-DRAW-001');
delete from promissory_notes where pn_number = 'PN-DEMO-DRAW-001';

insert into promissory_notes
  (name, pn_number, finance_institution, facility_type_id,
   transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('PN เดโม — ลงบัญชีวันเบิกเงิน', 'PN-DEMO-DRAW-001', 'BBL',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-09-01', '2026-12-01', 91, 1000000, 'THB', 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb);
