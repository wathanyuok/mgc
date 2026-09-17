-- ============================================================
-- Seed: FP-57 — ลงบัญชีรายงวด (Accrued Interest + Curtailment)
-- FP (Active) โหมด Curtailment · รถรวม 1,000,000 · ดอกเบี้ย 5% Fixed
-- + ลงบัญชีวันเบิกเงิน (FP_DRAWDOWN) ไว้ให้แล้ว → กด "ลงบัญชีงวดนี้" ได้ทันที
--
-- ใน Schedule Calculate จะมีงวดที่มีทั้ง "ดอกเบี้ย" และ "ลดต้น" (งวด milestone 90/180/270)
-- กด "ลงบัญชีงวดนี้" ที่งวด milestone → ได้ 2 ใบแยกกัน:
--   ดอกเบี้ย: Dr 5512112 ดอกเบี้ยจ่าย-Floor Plan / Cr 2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน
--   ลดต้น  : Dr 2142101 Note Payable - Floor Plan / Cr 1001201 Cash - Bank
-- ============================================================
begin;

-- ล้างของเดิม — ครอบทุกชื่อที่เคยใช้ + ลบด้วย id ด้วย (กันชน PK จากการรันเวอร์ชันเก่า)
delete from je_lines
 where je_id in (select id from journal_entries
                 where source_id in (select id from floor_plans
                   where fp_no in ('FP-DEMO-FP57','FP-DEMO-PRD916','FP-SEED-PERIOD')
                      or id = '11111111-1111-1111-1111-1111111d9161'));
delete from journal_entries
 where source_id in (select id from floor_plans
   where fp_no in ('FP-DEMO-FP57','FP-DEMO-PRD916','FP-SEED-PERIOD')
      or id = '11111111-1111-1111-1111-1111111d9161');
delete from fp_chassis
 where fp_id in (select id from floor_plans
   where fp_no in ('FP-DEMO-FP57','FP-DEMO-PRD916','FP-SEED-PERIOD')
      or id = '11111111-1111-1111-1111-1111111d9161');
delete from floor_plans
 where fp_no in ('FP-DEMO-FP57','FP-DEMO-PRD916','FP-SEED-PERIOD')
    or id = '11111111-1111-1111-1111-1111111d9161';

-- FP : 11111111-1111-1111-1111-1111111d9161
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, maturity_date,
   total_amount, amount, used_amount, currency, status, rate_cards)
values
  ('11111111-1111-1111-1111-1111111d9161', 'FP-DEMO-FP57', 'FP-DEMO-FP57',
   'KBANK', 'ผู้จำหน่ายไม่มีในทะเบียน', 'bmw',
   date '2026-05-01', date '2026-05-01', date '2027-05-01', date '2027-05-01',
   2000000, 2000000, 1000000, 'THB', 'Active',
   '[{"id":"aaaaaaaa-0000-0000-0000-00000000d961","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- รถ 2 คัน รวม 1,000,000
insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('11111111-1111-1111-1111-1111111d9161', 'FP57-CHS-001', 'BMW 320d', date '2026-05-01', 500000, 500000, 'In Stock', 0),
  ('11111111-1111-1111-1111-1111111d9161', 'FP57-CHS-002', 'BMW 520d', date '2026-05-01', 500000, 500000, 'In Stock', 1);

-- ใบสำคัญวันเบิกเงิน (FP_DRAWDOWN, Posted) — เพื่อให้ปุ่มลงบัญชีรายงวดกดได้เลย
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
values
  ('22222222-2222-2222-2222-2222222d9161', 'JE-DEMO-FP57', 'FP_DRAWDOWN',
   '11111111-1111-1111-1111-1111111d9161', null, date '2026-05-01', 'May 2026',
   'FP-DEMO-FP57 — Floor Plan Drawdown', 1000000, 1000000, 'Posted',
   'seed', now(), false, 'seed: ใบเบิกเงิน สำหรับทดสอบลงบัญชีรายงวด');

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('22222222-2222-2222-2222-2222222d9161', 1, '1151101', 'Inventory — Floor Plan', 1000000, 0, 'Inventory at cost'),
  ('22222222-2222-2222-2222-2222222d9161', 2, '2142101', 'AP — Floor Plan (Bank)', 0, 1000000, 'Note Payable — Floor Plan drawdown');

commit;

-- ตรวจ: เปิด FP-DEMO-FP57 → แท็บ Schedule Calculate
--   ปุ่ม "ลงบัญชีงวดนี้" กดได้ (เพราะลงวันเบิกเงินแล้ว)
--   กดที่งวด milestone (มีทั้งดอกเบี้ย + ลดต้น) → เกิดใบสำคัญ 2 ใบ
--   กดที่งวดที่มีแต่ดอกเบี้ย → เกิด 1 ใบ
