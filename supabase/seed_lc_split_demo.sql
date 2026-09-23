-- =====================================================================
-- Seed: L/C แม่ (Active) พร้อมทดสอบ "การรับมอบแบบทยอย (LC Split)"
--        ครอบคลุม LC-41 (การ์ด 3 ใบ) และ LC-43 (ใส่ยอดเกินคงเหลือ)
-- =====================================================================
-- L/C สัญญาแม่ · สถานะ Active · ไม่ใช่สัญญาย่อย · กรอกครบทุก field
--   ยอดตาม LC (amount_foreign) = 300,000 USD · rate 35.20 → 10,560,000 THB
--   DOL (จำนวนวันผ่อนผัน) = 60 วัน → Expiry ของ sub = วันรับของ + 60
--   acct_cards ผูกครบตามผัง COA จริง (fee/prepaid/cash/AP/FX)
--
-- ── วิธีทดสอบ ────────────────────────────────────────────────────────
--   LC-41: เปิด LC-DEMO-SPLIT → เลื่อนหา "การรับมอบแบบทยอย (LC Split)"
--          → เห็นการ์ด 3 ใบ (ยอดตาม LC / รับมอบแล้ว / คงเหลือรอรับ)
--          → คงเหลือรอรับ = 300,000 พื้นเหลือง (ยังไม่รับ)
--   LC-43: กด + รับมอบ Lot → ช่อง "ยอดรับมอบ Lot นี้" ใส่ 500,000 (เกิน 300,000)
--          → กด สร้าง Sub-LC → error "ยอดรับมอบ 500,000 เกินคงเหลือ 300,000 USD"
--   สร้าง sub จริง: ใส่ 300,000 + วันรับของ → เกิด LC-DEMO-SPLIT-S1 (Draft)
--          → Expiry = วันรับของ + 60 วัน · คงเหลือ = 0 พื้นเขียว + Badge "รับครบแล้ว"
--
-- รันซ้ำได้ (ลบ sub-LC + JE + LC แม่เดิมก่อน)
-- =====================================================================

delete from journal_entries
 where source_id in (select id from letters_of_credit
                     where lc_no = 'LC-DEMO-SPLIT' or lc_no like 'LC-DEMO-SPLIT-S%');
delete from letters_of_credit where lc_no like 'LC-DEMO-SPLIT-S%';   -- ลูกก่อน
delete from letters_of_credit where lc_no = 'LC-DEMO-SPLIT';          -- แม่

insert into letters_of_credit
  (id, lc_no, name, parent_lc_id, ca_id, finance_institution, lc_type,
   beneficiary, applicant, currency,
   amount_foreign, conversion_rate, conversion_date, amount,
   issue_date, transaction_date, expiry_date, term_days,
   estimated_arrival_date, actual_arrival_date, deal_of_lending_days,
   fee_mode, fee_rate, engagement_fee, fee_amount,
   shared_limit_with_tr, reference_contract,
   status, rate_cards, acct_cards, remark,
   created_by, updated_by)
values
  ('55555555-0000-0000-0000-0000000005c0',
   'LC-DEMO-SPLIT', 'LC เดโม — รับมอบแบบทยอย', null,
   null, 'BBL', 'Sight',
   'Bayerische Motoren Werke AG', 'บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด', 'USD',
   300000, 35.20, current_date - 15, 10560000,
   current_date - 15, current_date - 15, current_date + 75, 90,
   current_date + 10, null, 60,
   'full_term', 1.50, 0, 158400,
   false, null,
   'Active',
   '[{"id":"rc-1","type":"Fixed","rate":1.5,"condition":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"FEE EXPENSE ACCOUNT","gl":"5511101 ค่าธรรมเนียมธนาคาร"},
     {"id":"ac-2","type":"PREPAID ACCOUNT","gl":"1191405 ค่าใช้จ่ายจ่ายล่วงหน้า-ค่าธรรมเนียม"},
     {"id":"ac-3","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},
     {"id":"ac-4","type":"AP CAR ACCOUNT","gl":"2121206 เจ้าหนี้การค้าต่างประเทศ-Non RPT"},
     {"id":"ac-5","type":"FX GAIN ACCOUNT","gl":"4929103 กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"},
     {"id":"ac-6","type":"FX LOSS ACCOUNT","gl":"5439907 ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา"}]'::jsonb,
   'เดโมสำหรับทดสอบ LC Split (LC-41 / LC-43)',
   'Seed', 'Seed');
