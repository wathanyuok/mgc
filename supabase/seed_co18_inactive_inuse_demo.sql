-- ============================================================
-- Seed: CO-18 — ปิดใช้งานบัญชี COA ที่มีสัญญาตั้งไว้ → เตือนก่อน
--
--   สร้างบัญชี COA 1 รหัส (CO18-9999999 · Active) + เงินกู้ 1 ฉบับที่ acct_cards มีรหัสนี้
--   → เปิด COA รหัสนี้ (Edit) → เปลี่ยน STATUS เป็น Inactive → Save
--   → ขึ้นกล่องยืนยัน "บัญชี CO18-9999999 ถูกตั้งไว้ในสัญญา 1 รายการ ..."
--
-- วิธีทดสอบ CO-18:
--   เมนู COA → ค้นหา "CO18-9999999" → เปิด Edit → STATUS = Inactive → Save → เห็นกล่องยืนยัน
--
-- หมายเหตุ: ระบบนับการใช้งานจาก acct_cards (ilike %code%) ใน 10 ตาราง
--           (CA / PN / LG / LC / FP / OD / TR / FXF / Loan / Lease)
-- FIELD ครบ · รันซ้ำได้
-- ============================================================

-- ล้างของเดิม
delete from loans       where loan_no = 'LN-CO18-DEMO';
delete from gl_accounts where code = 'CO18-9999999';

-- 1) บัญชี COA (Active) ที่จะทดสอบปิดใช้งาน
insert into gl_accounts
  (company, code, name, account_category, fs_no, fs_name, fs_group, conso_group, nfs_group, inactive)
values
  ('MGC', 'CO18-9999999', 'บัญชีทดสอบ CO-18 (Demo)', 'Asset',
   'FS-TEST', 'FS Name Test', 'FS Group Test', 'Conso Test', 'NFS Test', false);

-- 2) เงินกู้ที่ acct_cards อ้างอิงรหัสบัญชีนี้ → ทำให้ตอนปิดใช้งานขึ้นเตือน
insert into loans
  (loan_no, name, ca_id, finance_institution, principal, amount, annual_rate, term_months,
   start_date, payment_freq, currency, status, acct_cards, remark)
values
  ('LN-CO18-DEMO', 'LN-CO18-DEMO', null, 'KBANK', 500000, 500000, 7.0000, 12,
   date '2026-01-01', 'monthly', 'THB', 'Active',
   '[{"type":"LOAN ACCOUNT","gl":"CO18-9999999 บัญชีทดสอบ CO-18 (Demo)"}]'::jsonb,
   'seed CO-18 · acct_cards อ้างอิง CO18-9999999 → ปิดใช้งานบัญชีนั้นต้องเตือน');

-- ตรวจผล
select code, name, inactive from gl_accounts where code = 'CO18-9999999';
select loan_no, acct_cards from loans where loan_no = 'LN-CO18-DEMO';
-- คาดหวัง: ปิดใช้งาน CO18-9999999 → กล่องยืนยัน "ถูกตั้งไว้ในสัญญา 1 รายการ"
