-- ============================================================
-- Seed: FP Regenerate → 3 ใบ (ใบเดิมส่ง NetSuite แล้ว)
-- Floor Plan (Active) + รถ 2 คัน + ใบสำคัญ Posted 1 ใบ ที่ sync_status='synced'
-- เปิดสัญญานี้ → แท็บ Chassis ปุ่มจะเป็น "Regenerate Journal Entry"
-- กด Regenerate → เพราะใบเดิมส่ง NetSuite แล้ว ยกเลิกทิ้งเฉยๆ ไม่ได้
--   ระบบจะออก "ใบกลับรายการ" (contra, Dr↔Cr สลับ) + ลงใบใหม่
--   → รวม 3 ใบ: เดิม(Posted) + กลับรายการ + ใหม่
-- ============================================================
begin;

-- ล้างของเดิมถ้าเคยรัน
delete from je_lines
 where je_id in (select id from journal_entries
                 where source_type = 'FP_DRAWDOWN'
                   and source_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN3'));
delete from journal_entries
 where source_type = 'FP_DRAWDOWN'
   and source_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN3');
delete from fp_chassis
 where fp_id in (select id from floor_plans where fp_no = 'FP-SEED-REGEN3');
delete from floor_plans where fp_no = 'FP-SEED-REGEN3';

-- FP  : 11111111-1111-1111-1111-1111111111f5
-- JE  : 22222222-2222-2222-2222-2222222222f5
insert into floor_plans
  (id, fp_no, name, finance_institution, vendor, schedule_mode,
   start_date, transaction_date, end_date, total_amount, amount, used_amount,
   currency, status)
values
  ('11111111-1111-1111-1111-1111111111f5', 'FP-SEED-REGEN3', 'FP-SEED-REGEN3',
   'KBANK', 'ผู้จำหน่ายทดสอบ', 'other',
   date '2026-05-01', date '2026-05-01', date '2026-08-01',
   2000000, 2000000, 1000000, 'THB', 'Active');

-- รถ 2 คัน คันละ 500,000 → รวมยอดเบิก 1,000,000
insert into fp_chassis (fp_id, chassis_no, model, receive_date, amount, chassis_price, status, sort_order)
values
  ('11111111-1111-1111-1111-1111111111f5', 'SEEDCHASSIS3-001', 'BMW 320d', date '2026-05-01', 500000, 500000, 'In Stock', 0),
  ('11111111-1111-1111-1111-1111111111f5', 'SEEDCHASSIS3-002', 'BMW 520d', date '2026-05-01', 500000, 500000, 'In Stock', 1);

-- ใบสำคัญวันเบิกเงิน (Posted) + ส่ง NetSuite แล้ว (sync_status='synced')
insert into journal_entries
  (id, je_number, source_type, source_id, source_period, je_date, posting_period,
   description, total_dr, total_cr, status, posted_by, posted_at, is_reversal, remark,
   sync_status, netsuite_je_id)
values
  ('22222222-2222-2222-2222-2222222222f5', 'JE-SEED-FPREGEN3', 'FP_DRAWDOWN',
   '11111111-1111-1111-1111-1111111111f5', null, date '2026-05-01', 'May 2026',
   'FP-SEED-REGEN3 — Floor Plan Drawdown', 1000000, 1000000, 'Posted',
   'seed', now(), false, 'seed: ใบเบิกเงินเดิม (ส่ง NetSuite แล้ว) สำหรับทดสอบ Regenerate → 3 ใบ',
   'synced', 'NS-SEED-0001');

insert into je_lines (je_id, line_no, account_code, account_name, dr, cr, description)
values
  ('22222222-2222-2222-2222-2222222222f5', 1, '1151101', 'Inventory — Floor Plan', 1000000, 0, 'Inventory at cost'),
  ('22222222-2222-2222-2222-2222222222f5', 2, '2142101', 'AP — Floor Plan (Bank)', 0, 1000000, 'Note Payable — Floor Plan drawdown');

commit;

-- ตรวจก่อนทดสอบ (ควรเห็น 1 ใบ Posted · sync_status = synced):
--   select je_number, status, is_reversal, sync_status, total_dr, total_cr
--     from journal_entries
--    where source_type='FP_DRAWDOWN'
--      and source_id='11111111-1111-1111-1111-1111111111f5';
-- หลังกด Regenerate ควรเห็น 3 ใบ: เดิม(Posted) + กลับรายการ(is_reversal) + ใหม่(Posted)
