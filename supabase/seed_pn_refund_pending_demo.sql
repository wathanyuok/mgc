-- ============================================================
-- Seed: facility_adjustments (refund_pending = true) → Reconcile โชว์ "Overcut" + ปุ่ม "รับเงินคืนแล้ว"
-- ผูกกับ PN-RO1-ORIG (d9d9b000-...0011) งวด 2 — ธนาคารตัดเกิน
--   TOTAL DUE งวด 2 = 4,246.58 · ธนาคารตัดจริง 4,300.00 → จ่ายเกิน 53.42
--   => refund_pending = true · refund_amount = 53.42 · ยังไม่ได้รับเงินคืน (refund_received_date = null)
--   สถานะงวด = Overcut (เงินคืนค้างรับ) → หน้า Reconcile จะมีปุ่ม "รับเงินคืนแล้ว" + วันที่
-- หมายเหตุ: total ไม่เปลี่ยน (original_total = adjusted_total = 4,246.58) → ไม่มี JE reallocation
--           (การจ่ายเกินไม่ใช่การย้ายเงินต้น↔ดอก จึงไม่ post JE · แค่ตั้ง flag เงินคืนค้างรับ)
-- ต้องรัน: seed_pn_rollover_demo.sql (ให้มี PN-RO1-ORIG) + seed_pn_reconcile_bankstmt_demo.sql (ให้มี bank line งวด 2)
-- FIELD ครบทุกช่อง · รันซ้ำได้ (ลบ adjustment เดิมก่อน)
-- ============================================================

-- ลบ adjustment เดิม (รันซ้ำได้)
delete from facility_adjustments
 where id = 'd9d9ba00-0000-0000-0000-0000000000f2';
delete from facility_adjustments
 where facility_id = 'd9d9b000-0000-0000-0000-000000000011'
   and period = 2
   and reason = 'bank_overcut';

-- insert facility_adjustments · field ครบทุกช่อง
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
  ('d9d9ba00-0000-0000-0000-0000000000f2',
   (select id from facility_types where code = 'PN' limit 1),
   'd9d9b000-0000-0000-0000-000000000011',
   2,
   'd9d9bb00-0000-0000-0000-0000000000e2',                 -- bank line งวด 2 (ตัด 4,300.00)
   0, 4246.58, 4246.58,                                    -- original: ดอกเบี้ยทั้งงวด (P/N จ่ายดอกอย่างเดียว)
   0, 4246.58, 4246.58,                                    -- adjusted: เท่าเดิม (ไม่ย้ายต้น↔ดอก)
   true, 53.42, null,                                      -- จ่ายเกิน 53.42 · ยังไม่ได้รับเงินคืน
   'bank_overcut',
   'seed · ธนาคารตัดเกิน 53.42 (4,300.00 − 4,246.58) · รอรับเงินคืนจากธนาคาร → กด "รับเงินคืนแล้ว" เพื่อเคลียร์',
   null, 'Posted',
   now());

-- ตรวจผล
select fa.period, fa.original_total, fa.adjusted_total,
       fa.refund_pending, fa.refund_amount, fa.refund_received_date, fa.reason, fa.status,
       (select pn_number from promissory_notes p where p.id = fa.facility_id) as pn
  from facility_adjustments fa
 where fa.facility_id = 'd9d9b000-0000-0000-0000-000000000011'
 order by fa.period;
