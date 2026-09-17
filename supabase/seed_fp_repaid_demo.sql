-- ============================================================
-- Seed: FP-60 — ลงบัญชีงวดลดต้นจนหมดหนี้ → สถานะ Repaid อัตโนมัติ
-- ตั้ง Curtailment master ของ vendor นี้เป็น "100% ที่ day 30" (milestone เดียว)
-- → กดลงบัญชีงวดลดต้น 1 ครั้ง ยอดคงเหลือเหลือ 0 → ระบบตั้งสถานะ Repaid ให้เอง
--
-- FP (Active) · รถรวม 1,000,000 · ดอกเบี้ย 5% · ลงบัญชีวันเบิกเงินไว้ให้แล้ว
-- คาดหวัง: กด "ลงบัญชีงวดนี้" ที่งวดลดต้น (day 30, 100%) → toast "Status → Repaid 🎉"
-- ============================================================
begin;

-- ล้างของเดิม — ครอบทุกชื่อที่เคยใช้ + ลบด้วย id ด้วย (กันชน PK จากการรันเวอร์ชันเก่า)
delete from je_lines
 where je_id in (select id from journal_entries
                 where source_id in (select id from floor_plans
                   where fp_no in ('FP-DEMO-FP60','FP-DEMO-RPD916','FP-SEED-REPAID')
                      or id = '11111111-1111-1111-1111-1111111d9160'));
delete from journal_entries
 where source_id in (select id from floor_plans
   where fp_no in ('FP-DEMO-FP60','FP-DEMO-RPD916','FP-SEED-REPAID')
      or id = '11111111-1111-1111-1111-1111111d9160');
delete from fp_chassis
 where fp_id in (select id from floor_plans
   where fp_no in ('FP-DEMO-FP60','FP-DEMO-RPD916','FP-SEED-REPAID')
      or id = '11111111-1111-1111-1111-1111111d9160');
delete from floor_plans
 where fp_no in ('FP-DEMO-FP60','FP-DEMO-RPD916','FP-SEED-REPAID')
    or id = '11111111-1111-1111-1111-1111111d9160';
delete from curtailments where vendor in ('Vendor Demo FP60','Vendor Demo RPD916','ผู้จำหน่ายทดสอบ Repaid');

-- Curtailment master: 100% ที่ day 30 (milestone เดียว → ปิดหนี้ทันที)
insert into curtailments
  (vendor, vehicle_type, effective_start_date, effective_end_date,
   tier1_days, tier1_pct, tier2_days, tier2_pct, tier3_days, tier3_pct, status, remark)
values
  ('Vendor Demo FP60', 'New', date '2026-01-01', null,
   30, 100, null, null, null, null, 'Active', 'seed: milestone เดียว 100% สำหรับทดสอบ Repaid');

-- FP : 11111111-1111-1111-1111-1111111d9160
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, status, rate_cards)
values
  ('11111111-1111-1111-1111-1111111d9160', 'FP-DEMO-FP60', 'FP-DEMO-FP60',
   'KBANK', 'Vendor Demo FP60', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2026-12-31', date '2026-12-31',
   2000000, 2000000, 1000000, 'THB', 'Active',
   '[{"id":"aaaaaaaa-0000-0000-0000-00000000d916","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('11111111-1111-1111-1111-1111111d9160', 'FP60-CHS-001', 'BMW 320d', date '2026-05-01', 500000, 500000, 'In Stock', 0),
  ('11111111-1111-1111-1111-1111111d9160', 'FP60-CHS-002', 'BMW 520d', date '2026-05-01', 500000, 500000, 'In Stock', 1);

-- ใบสำคัญวันเบิกเงิน (FP_DRAWDOWN, Posted) — ให้ลงบัญชีรายงวดได้เลย
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
values
  ('22222222-2222-2222-2222-2222222d9160', 'JE-DEMO-FP60', 'FP_DRAWDOWN',
   '11111111-1111-1111-1111-1111111d9160', null, date '2026-05-01', 'May 2026',
   'FP-DEMO-FP60 — Floor Plan Drawdown', 1000000, 1000000, 'Posted',
   'seed', now(), false, 'seed: ใบเบิกเงิน สำหรับทดสอบ Repaid');

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('22222222-2222-2222-2222-2222222d9160', 1, '1151101', 'Inventory — Floor Plan', 1000000, 0, 'Inventory at cost'),
  ('22222222-2222-2222-2222-2222222d9160', 2, '2142101', 'AP — Floor Plan (Bank)', 0, 1000000, 'Note Payable — Floor Plan drawdown');

commit;

-- ตรวจ: เปิด FP-DEMO-FP60 → แท็บ Schedule Calculate (โหมด Curtailment)
--   จะเห็นงวดลดต้น 100% (day 30) · กด "ลงบัญชีงวดนี้" ที่งวดนั้น
--   → ยอดคงเหลือ = 0 → toast "Status → Repaid 🎉" → สถานะเปลี่ยนเป็น Repaid
