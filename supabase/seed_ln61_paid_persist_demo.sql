-- ============================================================
-- Seed: LN-61 — บันทึกซ้ำแล้วสถานะการชำระไม่หาย
--
--   LN-DEMO-61 (Active) · PRINCIPAL 1,200,000 · Fixed 10%/ปี · 12 งวด · รายเดือน
--   + seed loan_schedules 3 งวดแรก โดย "งวด 1 = paid=true" ไว้ล่วงหน้า
--
--   วิธีทดสอบ LN-61:
--     1) เปิด LN-DEMO-61 → งวด 1 ขึ้นสถานะชำระแล้ว
--     2) กด Save อีกครั้ง (ระบบลบ+สร้างตารางงวดใหม่)
--     3) ดูงวด 1 → ยังเป็น "ชำระแล้ว" เหมือนเดิม (paid ไม่หาย)
--
--   คาดหวัง: หลัง Save ซ้ำ งวด 1 ยัง paid=true · paid_date คงเดิม · ไม่กลับเข้า Overdue Report
--
-- หมายเหตุ: เลขในตารางงวดตรงกับที่ระบบคำนวณจริง (Fixed 10% · 1.2M · 12 งวด)
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (loan_schedules ลบตาม cascade เมื่อลบ loan)
delete from journal_entries where source_id = 'd1610000-0000-0000-0000-000000000061';
delete from loans where id = 'd1610000-0000-0000-0000-000000000061' or loan_no = 'LN-DEMO-61';

-- 1) Loan (ตั้ง id ตายตัวเพื่ออ้างใน loan_schedules)
insert into loans
  (id, loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, transaction_date, installment_start_date, payment_freq, currency,
   payment_type, pay_eom, status, rate_cards, acct_cards, remark)
values
  ('d1610000-0000-0000-0000-000000000061','LN-DEMO-61','LN-DEMO-61', null, 'KBANK', 1200000, 1200000, 10.0000, 12,
   date '2026-01-01', date '2026-01-01', date '2026-01-31', 'monthly', 'THB',
   'Fix Installment / Fix Installment & Step payment', true, 'Active',
   '[{"type":"Fixed","rate":10,"condition":0,"start_date":"2026-01-01"}]'::jsonb,
   '[]'::jsonb,
   'seed LN-61 · งวด 1 paid=true ไว้ → Save ซ้ำแล้วต้องไม่หาย');

-- 2) ตารางงวด 3 งวดแรก (ตัวเลขตรงกับที่ระบบคำนวณ) · งวด 1 ชำระแล้ว
insert into loan_schedules
  (loan_id, period, due_date, begin_balance, payment, interest, principal, end_balance, paid, paid_date)
values
  ('d1610000-0000-0000-0000-000000000061', 1, date '2026-02-28', 1200000.00, 105499.06, 9205.48, 96293.59, 1103706.41, true,  date '2026-02-28'),
  ('d1610000-0000-0000-0000-000000000061', 2, date '2026-03-31', 1103706.41, 105499.06, 9373.94, 96125.12, 1007581.29, false, null),
  ('d1610000-0000-0000-0000-000000000061', 3, date '2026-04-30', 1007581.29, 105499.06, 8281.49, 97217.57,  910363.72, false, null);

-- ตรวจผล
select period, due_date, payment, interest, paid, paid_date
  from loan_schedules where loan_id = 'd1610000-0000-0000-0000-000000000061' order by period;
-- คาดหวัง: งวด 1 paid=true · หลังเปิดแล้วกด Save ซ้ำ → งวด 1 ยัง paid=true (ไม่หาย)
