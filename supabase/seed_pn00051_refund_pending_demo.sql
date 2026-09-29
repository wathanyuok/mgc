-- ============================================================
-- Seed: Refund Pending (แบงก์ตัดเกิน) สำหรับ PN00051 "ตัวจริง"
--   facility_id = a81552cf-d9ca-4790-b777-bfef1d0ad6db  (PN00051 ที่เปิดดูในหน้าจอ)
-- Scenario (อิงยอด Reconcile ของ PN00051):
--   งวด 1 : due 30/09/2026 · TOTAL DUE 27.40   → ธนาคารตัด 27.40  (ตรง → Bank Confirmed)
--   งวด 2 : due 31/10/2026 · TOTAL DUE 424.66  → ธนาคารตัด 450.00 (เกิน 25.34 → Overcut)
--            => facility_adjustments.refund_pending = true · refund_amount = 25.34
--            => หน้า Reconcile โชว์การ์ด "💰 Refund Pending" + ปุ่ม "ได้รับแล้ว"
--   งวด 3 : ไม่ใส่ (Unpaid)
-- total ไม่เปลี่ยน (original_total = adjusted_total = 424.66) → ไม่มี JE (แค่ตั้ง flag เงินคืนค้างรับ)
-- FIELD ครบทุกช่อง · SELF-CONTAINED · รันซ้ำได้
-- *** ให้รันไฟล์นี้แทน seed_pn00051_reconcile_demo.sql สำหรับ demo เงินคืน ***
--     (สร้าง statement เดียวกัน id ...b1 แต่งวด 2 เป็นยอดตัดเกิน)
-- ============================================================

-- resolve facility_id (ตรงๆ · เผื่อ id ไม่ตรงก็ fallback lookup pn_number)
-- ⓪ DIAGNOSTIC
select id, pn_number, name, status from promissory_notes
 where id = 'a81552cf-d9ca-4790-b777-bfef1d0ad6db'
    or pn_number ilike '%00051%';

-- ── ลบของเดิม (รันซ้ำได้) ──
delete from facility_adjustments
 where facility_id = 'a81552cf-d9ca-4790-b777-bfef1d0ad6db' and period = 2 and reason = 'bank_overcut';
delete from bank_statement_lines where statement_id = 'd9d9bc00-0000-0000-0000-0000000000b1';
delete from bank_statements      where id           = 'd9d9bc00-0000-0000-0000-0000000000b1';

-- ① Bank Statement (หัว) · field ครบ
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9bc00-0000-0000-0000-0000000000b1','BBL','181-3-11063-0',
   'PN00051 — Refund/Reconcile Demo','2026-Q4','Manual', false,
   'seed · statement demo เงินคืนค้างรับของ PN00051 (งวด2 ตัดเกิน)', now(), now());

-- ② Bank Statement Lines · ผูก PN00051 · source_period · field ครบ
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance,
   source, remark, sort_order, facility_type_id, facility_id, source_period)
values
  -- งวด 1 : ตรง → Bank Confirmed
  ('d9d9bc00-0000-0000-0000-0000000000e1','d9d9bc00-0000-0000-0000-0000000000b1',
   date '2026-09-30','10:15','TRANSFER','จ่ายดอกเบี้ย PN00051 งวด 1', 0, 27.40, 27.40,
   'Manual','seed · ตรง TOTAL DUE งวด 1', 0,
   (select id from facility_types where code='PN' limit 1),
   'a81552cf-d9ca-4790-b777-bfef1d0ad6db', 1),
  -- งวด 2 : ตัดเกิน 25.34 → Overcut (refund pending)  ← seed ใส่ adjustment ให้แล้ว (ดูข้อ ③)
  ('d9d9bc00-0000-0000-0000-0000000000e2','d9d9bc00-0000-0000-0000-0000000000b1',
   date '2026-10-31','10:20','TRANSFER','จ่ายดอกเบี้ย PN00051 งวด 2 (ตัดเกิน)', 0, 450.00, 477.40,
   'Manual','seed · ควร 424.66 ตัดจริง 450.00 → เกิน 25.34', 1,
   (select id from facility_types where code='PN' limit 1),
   'a81552cf-d9ca-4790-b777-bfef1d0ad6db', 2),
  -- งวด 3 : ตัดเกิน 30.14 → เตรียมไว้ให้ "ลองกด refund เอง"
  --   (seed ใส่แค่ bank line · ไม่ใส่ adjustment · ให้ user กด Create Repayment → Adjust → refund เอง)
  --   TOTAL DUE 100,369.86 · ตัดจริง 100,400.00 → เกิน 30.14
  ('d9d9bc00-0000-0000-0000-0000000000e3','d9d9bc00-0000-0000-0000-0000000000b1',
   date '2026-11-27','10:25','TRANSFER','จ่ายเงินต้น+ดอกเบี้ย PN00051 งวด 3 (ตัดเกิน)', 0, 100400.00, 100877.40,
   'Manual','seed · ควร 100,369.86 ตัดจริง 100,400.00 → เกิน 30.14 (ไว้ลอง refund เอง)', 2,
   (select id from facility_types where code='PN' limit 1),
   'a81552cf-d9ca-4790-b777-bfef1d0ad6db', 3);

-- ③ facility_adjustments (refund_pending = true) · field ครบทุกช่อง
insert into facility_adjustments
  (id,
   facility_type_id,
   facility_id,
   period,
   bank_statement_line_id,
   original_principal, original_interest, original_total,
   adjusted_principal, adjusted_interest, adjusted_total,
   refund_pending, refund_amount, refund_received_date,
   reason, notes,
   je_id, status,
   created_at)
values
  ('d9d9ba00-0000-0000-0000-0000000000f1',
   (select id from facility_types where code = 'PN' limit 1),
   'a81552cf-d9ca-4790-b777-bfef1d0ad6db',
   2,
   'd9d9bc00-0000-0000-0000-0000000000e2',                 -- bank line งวด 2 (ตัด 450.00)
   0, 424.66, 424.66,                                      -- original: ดอกเบี้ยทั้งงวด (P/N จ่ายดอกอย่างเดียว)
   0, 424.66, 424.66,                                      -- adjusted: เท่าเดิม (ไม่ย้ายต้น↔ดอก)
   true, 25.34, null,                                      -- ตัดเกิน 25.34 · ยังไม่ได้รับเงินคืน
   'bank_overcut',
   'seed · ธนาคารตัดเกิน 25.34 (450.00 − 424.66) · รอรับเงินคืน → กด "ได้รับแล้ว" เพื่อเคลียร์',
   null, 'Posted',
   now());

-- ตรวจผล
select fa.period, fa.original_total, fa.adjusted_total,
       fa.refund_pending, fa.refund_amount, fa.refund_received_date, fa.reason, fa.status,
       (select pn_number from promissory_notes p where p.id = fa.facility_id) as pn
  from facility_adjustments fa
 where fa.facility_id = 'a81552cf-d9ca-4790-b777-bfef1d0ad6db'
 order by fa.period;
