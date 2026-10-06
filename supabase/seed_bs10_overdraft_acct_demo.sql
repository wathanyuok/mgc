-- ============================================================
-- Seed: BS-10 — ลบใบแจ้งยอดที่เลขบัญชีตรงกับสัญญาเบิกเกินบัญชี → ถูกบล็อก
--
--   สร้าง Bank Statement 1 ใบ + Overdraft 1 สัญญา ที่ account_no ตรงกัน
--   → ลองลบใบแจ้งยอด → ระบบบล็อก "1 Overdraft (acct BS10-DEMO-ACCT)"
--   (ใบนี้ไม่มีบรรทัดผูกสัญญา เพื่อให้ข้อความมีแค่ส่วน Overdraft)
--
-- วิธีทดสอบ BS-10:
--   เมนู Bank Statement → หาใบ account_no "BS10-DEMO-ACCT" → กดถังขยะ → ยืนยัน
--   → toast แดง: "ลบไม่ได้ — ใช้งานโดย: 1 Overdraft (acct BS10-DEMO-ACCT) · กรุณา unlink ก่อน"
--
-- หมายเหตุ: การบล็อกจับคู่ OD ด้วย account_no (OD ไม่มี FK ตรงถึงใบแจ้งยอด)
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม (รันซ้ำได้)
delete from overdrafts      where od_no = 'OD-BS10-DEMO';
delete from bank_statements where id = 'b5100000-0000-0000-0000-000000000010' or account_no = 'BS10-DEMO-ACCT';

-- 1) ใบแจ้งยอด (ไม่มีบรรทัดผูกสัญญา)
insert into bank_statements
  (id, finance_institution, account_no, statement_name, statement_period, source, remark)
values
  ('b5100000-0000-0000-0000-000000000010', 'KBANK', 'BS10-DEMO-ACCT',
   'BS-10 Demo Statement', '2026-06', 'Manual',
   'seed BS-10 · เลขบัญชีตรงกับสัญญา Overdraft → ลบไม่ได้');

-- 2) สัญญาเบิกเกินบัญชี (Overdraft) ที่ account_no ตรงกับใบแจ้งยอด
insert into overdrafts
  (od_no, ca_id, finance_institution, facility_limit, start_date, end_date, account_no, status, remark)
values
  ('OD-BS10-DEMO', null, 'KBANK', 2000000, date '2026-01-01', date '2026-12-31',
   'BS10-DEMO-ACCT', 'Active', 'seed BS-10 · OD ที่ใช้เลขบัญชีเดียวกับใบแจ้งยอด');

-- ตรวจผล
select bs.account_no as stmt_acct, od.od_no, od.account_no as od_acct, od.status
  from bank_statements bs
  join overdrafts od on od.account_no = bs.account_no
 where bs.id = 'b5100000-0000-0000-0000-000000000010';
-- คาดหวัง: จับคู่ได้ 1 แถว → ลบใบแจ้งยอด → บล็อก "1 Overdraft (acct BS10-DEMO-ACCT)"
