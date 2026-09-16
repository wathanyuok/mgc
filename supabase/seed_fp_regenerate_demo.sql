-- ============================================================
-- Seed: FP Regenerate / Reverse demo
-- Floor Plan (Active) + รถ 2 คัน + ใบสำคัญ Posted 1 ใบ (FP_DRAWDOWN)
-- เปิดสัญญานี้ → แท็บ Chassis ปุ่มจะเป็น "Regenerate Journal Entry"
-- กด Regenerate → ระบบกลับรายการ (reverse) ใบเดิม + ลงใบใหม่
-- ตรวจที่เมนู Journal Entries: จะเห็น 3 ใบ (เดิม + กลับรายการ + ใหม่)
-- ============================================================
begin;

-- ล้างของเดิมถ้าเคยรัน (กลับรายการ/ลบใบสำคัญ + รถ + สัญญา)
delete from je_lines
 where je_id in (select id from journal_entries
                 where source_type = 'FP_DRAWDOWN'
                   and source_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN'));
delete from journal_entries
 where source_type = 'FP_DRAWDOWN'
   and source_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN');
delete from fp_chassis
 where fp_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN');
delete from floor_plans where fp_no = 'FP-SEED-REGEN';

-- ค่าคงที่ (UUID ตายตัวเพื่อผูกความสัมพันธ์)
-- FP  : 11111111-1111-1111-1111-1111111111f4
-- JE  : 22222222-2222-2222-2222-2222222222f4
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, total_amount, amount, used_amount,
   currency, status)
values
  ('11111111-1111-1111-1111-1111111111f4', 'FP-SEED-REGEN', 'FP-SEED-REGEN',
   'KBANK', 'ผู้จำหน่ายทดสอบ', 'other',
   date '2026-05-01', date '2026-05-01', date '2026-08-01',
   2000000, 2000000, 1000000, 'THB', 'Active');

-- รถ 2 คัน คันละ 500,000 → รวมยอดเบิก 1,000,000
insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('11111111-1111-1111-1111-1111111111f4', 'SEEDCHASSIS-001', 'BMW 320d', date '2026-05-01', 500000, 500000, 'In Stock', 0),
  ('11111111-1111-1111-1111-1111111111f4', 'SEEDCHASSIS-002', 'BMW 520d', date '2026-05-01', 500000, 500000, 'In Stock', 1);

-- ใบสำคัญวันเบิกเงิน (Posted, ไม่ใช่ใบกลับรายการ) — ผูกกับ FP นี้
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark)
values
  ('22222222-2222-2222-2222-2222222222f4', 'JE-SEED-FPREGEN', 'FP_DRAWDOWN',
   '11111111-1111-1111-1111-1111111111f4', null, date '2026-05-01', 'May 2026',
   'FP-SEED-REGEN — Floor Plan Drawdown', 1000000, 1000000, 'Posted',
   'seed', now(), false, 'seed: ใบเบิกเงินเดิม สำหรับทดสอบ Regenerate/Reverse');

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('22222222-2222-2222-2222-2222222222f4', 1, '1151101', 'Inventory — Floor Plan', 1000000, 0, 'Inventory at cost'),
  ('22222222-2222-2222-2222-2222222222f4', 2, '2142101', 'AP — Floor Plan (Bank)', 0, 1000000, 'Note Payable — Floor Plan drawdown');

commit;

-- ตรวจผลก่อนทดสอบ:
--   select fp_no, status, total_amount, used_amount from floor_plans where fp_no='FP-SEED-REGEN';
--   select je_number, status, is_reversal, total_dr, total_cr from journal_entries
--     where source_type='FP_DRAWDOWN'
--       and source_id='11111111-1111-1111-1111-1111111111f4';
