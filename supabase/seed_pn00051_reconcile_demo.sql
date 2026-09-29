-- ============================================================
-- Seed: Bank Statement + lines ผูก PN00051 (ระบุ source_period) → Reconcile ขึ้น Bank Confirmed
-- FIELD ครบทุกช่อง · facility_id lookup จาก pn_number = 'PN00051'
-- อิงยอดจากตาราง Reconcile ของ PN00051:
--   งวด 1 : due 30/09/2026 · TOTAL DUE 27.40      → credit 27.40   (ตรง → Bank Confirmed)
--   งวด 2 : due 31/10/2026 · TOTAL DUE 424.66     → credit 424.66  (ตรง → Bank Confirmed)
--   งวด 3 : due 27/11/2026 · TOTAL DUE 100,369.86 → ไม่ใส่          (Unpaid)
-- credit > 0 → ปุ่ม "→ Create Repayment" จะขึ้นด้วย
-- รันซ้ำได้ (ลบ lines + statement เดิม)
-- ============================================================

-- ⓪ DIAGNOSTIC — หา PN ที่ชื่อ/เลขมี "00051" (ดูว่า pn_number จริงคืออะไร)
select id, pn_number, name, status from promissory_notes
 where pn_number ilike '%00051%' or name ilike '%00051%'
 order by created_at desc;

delete from bank_statement_lines where statement_id = 'd9d9bc00-0000-0000-0000-0000000000b1';
delete from bank_statements where id = 'd9d9bc00-0000-0000-0000-0000000000b1';

-- ① Bank Statement (หัว) · field ครบ
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9bc00-0000-0000-0000-0000000000b1','BBL','181-3-11063-0',
   'PN00051 — Reconcile Demo','2026-Q4','Manual', false,
   'seed · statement สำหรับ demo Reconcile ของ PN00051', now(), now());

-- ② Bank Statement Lines · ผูก facility_id = PN00051 (lookup จาก pn_number) · ระบุ source_period · field ครบ
insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance,
   source, remark, sort_order, facility_type_id, facility_id, source_period)
values
  ('d9d9bc00-0000-0000-0000-0000000000e1','d9d9bc00-0000-0000-0000-0000000000b1',
   date '2026-09-30','10:15','TRANSFER','จ่ายดอกเบี้ย PN00051 งวด 1', 0, 27.40, 27.40,
   'Manual','seed · ตรง TOTAL DUE งวด 1', 0,
   (select id from facility_types where code='PN' limit 1),
   coalesce((select id from promissory_notes where pn_number='PN00051' limit 1),
            (select id from promissory_notes where name='PN00051' limit 1),
            (select id from promissory_notes where pn_number ilike '%00051%' order by created_at desc limit 1)), 1),
  ('d9d9bc00-0000-0000-0000-0000000000e2','d9d9bc00-0000-0000-0000-0000000000b1',
   date '2026-10-31','10:20','TRANSFER','จ่ายดอกเบี้ย PN00051 งวด 2', 0, 424.66, 452.06,
   'Manual','seed · ตรง TOTAL DUE งวด 2', 1,
   (select id from facility_types where code='PN' limit 1),
   coalesce((select id from promissory_notes where pn_number='PN00051' limit 1),
            (select id from promissory_notes where name='PN00051' limit 1),
            (select id from promissory_notes where pn_number ilike '%00051%' order by created_at desc limit 1)), 2);

-- ตรวจผล (ต้องได้ facility_id ไม่ null = จับ PN00051 เจอ)
select bsl.source_period, bsl.tx_date, bsl.credit, bsl.facility_id,
       (select pn_number from promissory_notes p where p.id = bsl.facility_id) as pn
  from bank_statement_lines bsl
 where bsl.statement_id = 'd9d9bc00-0000-0000-0000-0000000000b1'
 order by bsl.source_period;
