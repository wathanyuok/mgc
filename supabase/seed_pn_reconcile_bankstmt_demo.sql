-- ============================================================
-- Seed: Bank Statement + lines ผูกกับ P/N → ให้แท็บ Reconcile จับคู่โชว์สถานะ
-- ผูกกับตั๋ว PN-RO1-ORIG (d9d9b000-...0011) — schedule 4 งวด (01/06→01/09/2026)
-- โชว์ 3 สถานะ:
--   งวด 1 : ธนาคารตัด 3,972.60 = ตรง TOTAL DUE  → Bank Confirmed (DIFF 0)
--   งวด 2 : ธนาคารตัด 4,300.00 (ควร 4,246.58)   → DIFF +53.42 (จ่ายเกิน · ไฮไลต์เหลือง รอ Adjust)
--   งวด 3,4 : ไม่มีรายการธนาคาร                  → Unpaid
-- ต้องรัน seed_pn_rollover_demo.sql ก่อน (ให้มี PN-RO1-ORIG)
-- รันซ้ำได้ (ลบ statement เดิมก่อน · lines ลบตาม cascade/ด้วยมือ)
-- ============================================================

-- ลบ lines + statement เดิม
delete from bank_statement_lines where statement_id = 'd9d9bb00-0000-0000-0000-0000000000b1';
delete from bank_statements where id = 'd9d9bb00-0000-0000-0000-0000000000b1';

-- ① Bank Statement (หัว)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, inactive, remark, created_at, updated_at)
values
  ('d9d9bb00-0000-0000-0000-0000000000b1','BBL','181-3-11063-0',
   'BBL Statement 2026-Q3','2026-Q3','Manual', false,
   'seed · statement สำหรับ demo Reconcile ของ PN-RO1-ORIG', now(), now());

-- ② Bank Statement Lines — ผูก facility_id = PN-RO1-ORIG, source_period ตามงวด
--   (debit = เงินจ่ายออกจาก MGC = ยอดที่ตัดจ่ายจริง)
delete from bank_statement_lines
 where facility_id = 'd9d9b000-0000-0000-0000-000000000011'
   and statement_id = 'd9d9bb00-0000-0000-0000-0000000000b1';

insert into bank_statement_lines
  (id, statement_id, tx_date, tx_time, txn_code, description, debit, credit, balance,
   source, remark, sort_order, facility_type_id, facility_id, source_period)
values
  -- งวด 1 : ตรง (Bank Confirmed) · ยอดที่ credit เพื่อให้ปุ่ม → Create Repayment ขึ้น
  ('d9d9bb00-0000-0000-0000-0000000000e1','d9d9bb00-0000-0000-0000-0000000000b1',
   date '2026-06-30','10:15','TRANSFER','จ่ายดอกเบี้ย P/N งวด 1', 0, 3972.60, 3972.60,
   'Manual','seed · ตรง TOTAL DUE งวด 1', 0,
   (select id from facility_types where code='PN' limit 1),
   'd9d9b000-0000-0000-0000-000000000011', 1),
  -- งวด 2 : จ่ายเกิน (DIFF +53.42 · ไฮไลต์เหลือง)
  ('d9d9bb00-0000-0000-0000-0000000000e2','d9d9bb00-0000-0000-0000-0000000000b1',
   date '2026-07-31','10:20','TRANSFER','จ่ายดอกเบี้ย P/N งวด 2 (ตัดเกิน)', 0, 4300.00, 8272.60,
   'Manual','seed · จ่ายเกิน — ควร 4,246.58 ตัดจริง 4,300.00', 1,
   (select id from facility_types where code='PN' limit 1),
   'd9d9b000-0000-0000-0000-000000000011', 2);

-- ตรวจผล
select bsl.source_period, bsl.tx_date, bsl.debit, bsl.description
  from bank_statement_lines bsl
 where bsl.facility_id = 'd9d9b000-0000-0000-0000-000000000011'
 order by bsl.source_period;
