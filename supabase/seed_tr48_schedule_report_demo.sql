-- =====================================================================
-- Seed: TR-48 (UC-TR-002) — ตารางงวดในรายงานกลาง (Due / Overdue Payment)
-- =====================================================================
-- ทดสอบว่างวดของ Trust Receipt โผล่ในรายงานกลาง และตัวเลขตรงกับตาราง
-- บนหน้าสัญญา (แท็บ Schedule Calculate)
--
-- ตั้งวันให้ "คร่อมวันนี้ (22/09/2026)" เพื่อให้ได้ทั้ง 2 รายงานในใบเดียว:
--   transaction_date = 01/07/2026 · maturity = 01/12/2026 · ดอกเบี้ย 5%
--   → buildPNSchedule สร้างงวดรายเดือน (ส.ค. / ก.ย. / ต.ค. / พ.ย. / ธ.ค.)
--      • งวดที่ครบกำหนดก่อน 22/09/2026 (ส.ค., ก.ย.) → Overdue Payment Report
--      • งวดที่ครบกำหนดหลัง 22/09/2026 (ต.ค.-ธ.ค.)  → Due Payment Report
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   1) เปิด Trust Receipt → TR-DEMO-48-SCHED
--   2) *** กด Save 1 ครั้ง ***  ← สำคัญ! ตารางงวดกลางถูกเขียนตอน Save
--        (syncScheduleFor('TR') ทำงานฝั่ง client จึงต้องเปิดหน้าแล้ว Save
--         seed เขียน trust_receipts ตรงๆ ได้ แต่เขียน installment_schedules
--         ให้ไม่ได้ — ต้องให้แอปคำนวณเพื่อให้ "ตรงกับหน้าจอ" แน่นอน)
--        ทางเลือก: หน้า Settings/Admin กดปุ่ม "Rebuild Schedules" ก็ได้เหมือนกัน
--   3) เปิดแท็บ "Schedule Calculate" → จด End Date + Interest แต่ละงวด
--   4) เมนู Reports → "Due Payment Report"     → เห็นงวด ต.ค.-ธ.ค.
--        Due Payment Date = End Date · Interest / Fee = Interest (ตรงกับข้อ 3)
--   5) เมนู Reports → "Overdue Payment Report" → เห็นงวด ส.ค.-ก.ย.
--        มีคอลัมน์ Overdue (Days) · ค่าอื่นตรงกับแท็บ Schedule Calculate
--
-- รันซ้ำได้ (ลบ TR + ตารางงวดที่เคยเกิดก่อน)
-- =====================================================================

-- ── ล้างของเดิม (รวมตารางงวดกลางที่เคยถูกเขียนไว้) ────────────────────
delete from installment_schedules
 where facility_id in (
   select id from trust_receipts where tr_no = 'TR-DEMO-48-SCHED'
 );
delete from trust_receipts where tr_no = 'TR-DEMO-48-SCHED';

-- ── สร้างสัญญา: อายุ ~5 เดือน คร่อมวันนี้ · มีอัตรา 5% (ตารางงวดคำนวณได้) ─
insert into trust_receipts
  (tr_no, name, finance_institution, supplier, invoice_no, invoice_date,
   transaction_date, due_date, maturity_date, term_days,
   amount, amount_foreign, currency, status, rate_cards)
values
  ('TR-DEMO-48-SCHED', 'TR-48 — ตารางงวดในรายงานกลาง (Due + Overdue)', 'BBL', 'Toyota Tsusho',
   'INV-48-001', '2026-07-01', '2026-07-01', '2026-12-01', '2026-12-01', 153,
   1200000, 1200000, 'THB', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-07-01"}]'::jsonb);

-- =====================================================================
-- อย่าลืม: หลังรัน seed → เปิด TR-DEMO-48-SCHED แล้ว "กด Save 1 ครั้ง"
--          เพื่อให้งวดไปโผล่ในรายงาน Due / Overdue Payment
-- =====================================================================
