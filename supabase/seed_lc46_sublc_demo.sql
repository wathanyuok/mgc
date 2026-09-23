-- =====================================================================
-- Seed: LC-46 (เปิดสัญญาย่อย) + LC-45 (รับมอบตอนยังไม่ Active)
-- =====================================================================
-- สร้าง 3 ใบ · กรอกครบทุก field:
--   A) LC-DEMO-SUB      — สัญญาแม่ Active · มีสัญญาย่อยแล้ว 1 ใบ (ไว้กดเปิด LC-46)
--   B) LC-DEMO-SUB-S1   — สัญญาย่อย (parent = A) · ไว้ทดสอบแถบ Sub-LC + ลิงก์กลับแม่
--   C) LC-DEMO-DRAFT    — สัญญาแม่ Draft · ไว้ทดสอบ LC-45 (ปุ่ม + รับมอบ Lot จาง)
--
-- ยอด: แม่เดิม 300,000 USD · แบ่งสัญญาย่อยไป 100,000 → แม่เหลือ (amount_foreign) 200,000
--   → การ์ด 3 ใบบนแม่: ยอดตาม LC 300,000 · รับมอบแล้ว 100,000 · คงเหลือ 200,000 (เหลือง)
-- Sub Expiry = วันรับของ + DOL 60 วัน
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   LC-46: เปิด LC-DEMO-SUB → ตาราง sub-LC → กดแถว LC-DEMO-SUB-S1
--          → เข้าหน้าย่อย · เห็นแถบ "Sub-LC จากการรับมอบแบบทยอย" + ลิงก์ "เปิด LC ตัวแม่"
--          · ไม่มีส่วน "การรับมอบแบบทยอย (LC Split)"
--   LC-45: เปิด LC-DEMO-DRAFT (Draft) → ปุ่ม + รับมอบ Lot จาง กดไม่ได้
--
-- รันซ้ำได้ (ลบลูกก่อนแม่)
-- =====================================================================

delete from letters_of_credit where lc_no in ('LC-DEMO-SUB-S1');            -- ลูกก่อน
delete from letters_of_credit where lc_no in ('LC-DEMO-SUB', 'LC-DEMO-DRAFT');

-- ── A) สัญญาแม่ Active (เหลือ 200,000 หลังแบ่งไป 100,000) ─────────────
insert into letters_of_credit
  (id, lc_no, name, parent_lc_id, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency,
   amount_foreign, conversion_rate, conversion_date, amount,
   issue_date, transaction_date, expiry_date, term_days,
   estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   shared_limit_with_tr, reference_contract,
   status, rate_cards, acct_cards, remark, created_by, updated_by)
values
  ('66666666-0000-0000-0000-0000000000c0',
   'LC-DEMO-SUB', 'LC เดโม — มีสัญญาย่อย', null,
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   200000, 35.20, current_date - 15, 7040000,
   current_date - 15, current_date - 15, current_date + 75, 90,
   current_date + 10, null, 60,
   'full_term', 1.50, 0, 105600,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-2","type":"PREPAID ACCOUNT","gl":"1191405 ค่าใช้จ่ายจ่ายล่วงหน้า-ค่าธรรมเนียม"},
     {"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-4","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้การค้าต่างประเทศ-Non RPT"},
     {"id":"ac-5","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-6","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'เดโมทดสอบ LC-46 (เปิดสัญญาย่อย)', 'Seed', 'Seed');

-- ── B) สัญญาย่อย (Sub-LC) 100,000 · parent = A ──────────────────────
insert into letters_of_credit
  (id, lc_no, name, parent_lc_id, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency,
   amount_foreign, conversion_rate, conversion_date, amount,
   issue_date, transaction_date, expiry_date, term_days,
   estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   shared_limit_with_tr, reference_contract,
   status, rate_cards, acct_cards, remark, created_by, updated_by)
values
  ('66666666-0000-0000-0000-0000000000c1',
   'LC-DEMO-SUB-S1', 'LC-DEMO-SUB-S1', '66666666-0000-0000-0000-0000000000c0',
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   100000, 35.20, current_date - 5, 3520000,
   current_date - 15, current_date - 5, current_date + 55, 60,
   null, current_date - 5, 60,
   'full_term', 1.50, 0, 52800,
   false, null,
   'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'รับมอบ lot ที่ 1 ของ LC-DEMO-SUB', 'Seed', 'Seed');

-- ── C) สัญญาแม่ Draft (สำหรับ LC-45 — ปุ่ม + รับมอบ Lot ต้องจาง) ──────
insert into letters_of_credit
  (id, lc_no, name, parent_lc_id, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency,
   amount_foreign, conversion_rate, conversion_date, amount,
   issue_date, transaction_date, expiry_date, term_days,
   estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   shared_limit_with_tr, reference_contract,
   status, rate_cards, acct_cards, remark, created_by, updated_by)
values
  ('66666666-0000-0000-0000-0000000000c2',
   'LC-DEMO-DRAFT', 'LC เดโม — Draft (รับมอบยังไม่ได้)', null,
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   250000, 35.20, current_date - 3, 8800000,
   current_date - 3, current_date - 3, current_date + 87, 90,
   current_date + 15, null, 60,
   'full_term', 1.50, 0, 132000,
   false, null,
   'Draft',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[]'::jsonb,
   'เดโมทดสอบ LC-45 (รับมอบตอนยังไม่ Active)', 'Seed', 'Seed');
