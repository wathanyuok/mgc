-- ============================================================
-- Seed: LSL-16 — จำนวนเงินเกินวงเงินคงเหลือ (Leasing/HP)
-- สร้างวงเงินที่ "เหลือจำกัด" ไว้ทดสอบว่าใส่ยอดเกินแล้วบันทึกไม่ได้ + ขึ้นข้อความ วงเงิน/ใช้ไป/คงเหลือ
--
--   • CA-LSL16-DEMO  วงเงิน Lease 10,000,000
--   • LSE-LSL16-USED สัญญาเช่า (Leasing · Active) principal 8,000,000 ใต้ CA → ใช้วงเงินไป 8,000,000
--   => วงเงินคงเหลือ = 10,000,000 − 8,000,000 = 2,000,000
--
-- วิธีทดสอบ:
--   1. เมนู Leasing (หรือ Hire Purchase) → + New
--   2. เลือก CREDIT AGREEMENT NAME = "CA-LSL16-DEMO ..."
--   3. ใส่ PRINCIPAL AMOUNT มากกว่า 2,000,000 (เช่น 5,000,000) → Save
--   ผล: บันทึกไม่ได้ · toast แดง
--     "วงเงินเต็มแล้ว — วงเงิน 10,000,000.00 · ใช้ไป 8,000,000.00 · คงเหลือ 2,000,000.00
--      · รายการนี้ 5,000,000.00 เกินวงเงิน ขอเพิ่มไม่ได้ (ต้องเพิ่มวงเงินที่ MA/CA ก่อน)"
--   4. ลดยอด ≤ 2,000,000 → Save ได้
--
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

delete from leases where id = 'd9d9e160-0000-0000-0000-0000000000a1' or lease_no = 'LSE-LSL16-USED';
delete from credit_agreements where id = 'd9d9e160-0000-0000-0000-0000000000c1' or contract_number = 'CA-LSL16-DEMO';
delete from ma_subsidiaries where ma_id = 'd9d9e160-0000-0000-0000-0000000000c2';
delete from master_agreements where id = 'd9d9e160-0000-0000-0000-0000000000c2' or ma_name = 'MA-LSL16-DEMO';

-- ①a MA — สัญญาหลัก (ให้ CA ผูก)
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('d9d9e160-0000-0000-0000-0000000000c2','BBL','MA-LSL16-DEMO','MGC','Approved',
   date '2026-09-01', date '2027-08-31', 10000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9e160-0000-0000-0000-0000000000c2','MGC',10000000,0,0);

-- ①b CA — วงเงิน Lease 10 ล้าน (ผูก MA)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status)
values
  ('d9d9e160-0000-0000-0000-0000000000c1',
   'd9d9e160-0000-0000-0000-0000000000c2',
   'CA-LSL16-DEMO (วงเงิน Lease 10 ล้าน)', 'CA-LSL16-DEMO', 'MGC',
   (select id from facility_types where code='LEASE' limit 1),
   10000000, 'THB', 'Revolving', 'BBL',
   date '2026-09-01', date '2027-08-31', 'Approved');

-- ② สัญญาเช่า (Leasing · Active) ใช้วงเงินไปแล้ว 8 ล้าน → เหลือ 2 ล้าน
insert into leases
  (id, lease_no, ca_id, subsidiary, mode, use_bank_loan, asset_type, asset_name,
   principal, annual_rate, term_months, start_date, status, remark, created_at, updated_at)
values
  ('d9d9e160-0000-0000-0000-0000000000a1','LSE-LSL16-USED',
   'd9d9e160-0000-0000-0000-0000000000c1','MGC','lease', true,
   'รถยนต์','รถบรรทุก (ใช้วงเงินไปแล้ว)',
   8000000, 5.0, 36, date '2026-09-01', 'Active',
   'seed LSL-16 · สัญญาเช่าที่กินวงเงินไป 8 ล้าน (เหลือ 2 ล้านไว้ทดสอบ)', now(), now());

-- ③ ตรวจผล
select c.contract_number, c.credit_line,
       (select coalesce(sum(greatest(l.principal,0)),0) from leases l
         where l.ca_id=c.id and l.status not in ('Closed','Cancelled','Rejected','Roll Over')) as used_lease,
       c.credit_line - (select coalesce(sum(greatest(l.principal,0)),0) from leases l
         where l.ca_id=c.id and l.status not in ('Closed','Cancelled','Rejected','Roll Over')) as available
  from credit_agreements c where c.id='d9d9e160-0000-0000-0000-0000000000c1';
-- คาดหวัง: credit_line 10,000,000 · used_lease 8,000,000 · available 2,000,000
