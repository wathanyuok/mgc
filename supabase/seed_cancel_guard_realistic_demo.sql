-- =====================================================================
-- Seed: Cancel Guard (แบบสมจริง) — เดินครบ flow เอง ไม่ลัดขั้นตอน
-- =====================================================================
-- ต่างจาก seed_cancel_guard_demo.sql ตรงที่ "ไม่ยัด JE ให้" — สร้างแค่สัญญา
-- Active ที่พร้อมลงบัญชี (มีอัตราดอกเบี้ย + ตารางงวดคำนวณได้) แล้วให้ผู้ใช้
-- กดปุ่ม "ลงบัญชีวันเบิกเงิน" เองตามการใช้งานจริง
--
-- ── วิธีทดสอบ (ต้องใช้บัญชีที่มีสิทธิ์ tr.approve เช่น Admin) ──────────
--   1) เปิด Trust Receipt → TR-DEMO-CX2-POST  (สถานะ Active)
--   2) ดูแท็บ "Schedule Calculate" → ตารางงวดขึ้นครบ (เพราะมีอัตรา 5%)
--   3) กดปุ่ม "ลงบัญชีวันเบิกเงิน" (มุมขวาบน)
--        → ระบบสร้าง JE เอง (createJE → postJE) · ปุ่มเปลี่ยนเป็น "กลับรายการวันเบิกเงิน"
--        → ดู JE ที่แท็บ "Accounting" หรือเมนู Journal Entries
--   4) ลองเปลี่ยนสถานะเป็น "Cancelled" แล้วกด Save
--        → เด้ง cancel guard: "T/R นี้มีใบสำคัญที่ลงบัญชีแล้ว (JE-…) — ยกเลิกไม่ได้ …"
--
--   เทียบเคส "ยังไม่ post" — TR-DEMO-CX2-CLEAN (Active เหมือนกัน แต่ไม่ต้องกด Post)
--        ลองกด Cancel ได้เลย → ยกเลิกสำเร็จ (ยังไม่มีกิจกรรมบัญชี)
--
-- หมายเหตุ: ปุ่ม "ลงบัญชีวันเบิกเงิน" ต้องมีสิทธิ์ tr.approve — บัญชี Checker03
--          กดไม่ได้ (ปุ่มจะจาง) · ให้ล็อกอินด้วย Admin เพื่อเดิน flow นี้
--
-- รันซ้ำได้ (ลบ JE ที่เคยเกิดจากการกดปุ่ม + TR ของเดิมก่อนทุกครั้ง)
-- =====================================================================

-- ── ล้างของเดิม (เผื่อเคยกด Post จนเกิด JE ไว้) ──────────────────────
delete from journal_entries
 where source_id in (
   select id from trust_receipts
    where tr_no in ('TR-DEMO-CX2-POST', 'TR-DEMO-CX2-CLEAN')
 );
delete from trust_receipts
 where tr_no in ('TR-DEMO-CX2-POST', 'TR-DEMO-CX2-CLEAN');

-- ── เคสหลัก: Active · มีอัตรา 5% · ยังไม่ post JE → ให้กด Post เอง ────
-- rate_cards = อัตราคงที่ 5% เริ่ม 01/09/2026 (โครงเดียวกับที่ UI สร้าง)
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   amount, amount_foreign, currency, status, rate_cards)
values
  ('TR-DEMO-CX2-POST', 'Cancel เดโม 2 — กด Post เอง แล้วลองยกเลิก', 'BBL', 'Toyota Tsusho',
   'INV-CX2-001', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   1800000, 1800000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb);

-- ── เคสเทียบ: Active เหมือนกัน แต่ไม่ต้อง post → ยกเลิกได้เลย ─────────
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   amount, amount_foreign, currency, status, rate_cards)
values
  ('TR-DEMO-CX2-CLEAN', 'Cancel เดโม 2 — Active ยังไม่ลงบัญชี (ยกเลิกได้)', 'BBL', 'Toyota Tsusho',
   'INV-CX2-002', '2026-09-01', '2026-09-01', '2026-12-01', '2026-12-01', 91,
   1200000, 1200000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}]'::jsonb);
