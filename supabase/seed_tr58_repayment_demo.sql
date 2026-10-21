-- =====================================================================
-- Seed: TR-58 — ทดสอบ Repayment "ล้างดอกเบี้ยค้างจ่ายได้ไม่เกินยอด accrued จริง"
--        (กฎรอบแก้: Dr 2197109 เท่ายอดค้างจริง · ส่วนเกิน Dr 5512110 ดอกเบี้ยจ่าย)
-- =====================================================================
-- TR 3,000,000 · 5% · 3 งวด (ดอกเบี้ยรายเดือน · เงินต้นคืนงวดสุดท้าย)
--   ดอกเบี้ย/งวด = 3,000,000 × 5% × 30/365 = 12,328.77
--   งวด 1: ดอก 12,328.77 · ต้น 0
--   งวด 2: ดอก 12,328.77 · ต้น 0
--   งวด 3: ดอก 12,328.77 · ต้น 3,000,000
--
--   acct_cards (ตรงกับที่โค้ดใช้ลงบัญชีจริง):
--     INVENTORY ACCOUNT        1151101 สินค้าคงเหลือ-ยานพาหนะ
--     NOTE PAYABLE ACCOUNT     2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน
--     INTEREST EXPENSE ACCOUNT 5512110 ดอกเบี้ยจ่าย-Short term loan from financial institutions
--     ACCRUED INTEREST ACCOUNT 2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน
--
-- *** หมายเหตุ: seed นี้สร้าง TR-TR58 แบบ standalone (CA/MA ของตัวเอง)
--     ถ้าเคยรัน seed_tr_batch_uc_demo ที่มี TR-TR58 อยู่ จะถูกลบทิ้งแล้วสร้างใหม่ที่นี่ ***
--
-- ⚠ หมายเหตุสำคัญ: ระบบคิด Accrued "ตามวันจริง" ของแต่ละงวด (เช่น 9/30/31/20 วัน)
--   จึงไม่เท่ากับ 12,328.77 คงที่ใน schedule — เทสเคสด้านล่างจึงอิง "ยอด accrued จริง
--   ที่ขึ้นในบัญชี 2197109" ไม่ใช่เลขคงที่ (โค้ด Repayment ล้าง 2197109 ตามยอดจริงในบัญชี)
--
-- ── วิธีทดสอบ 2 เคส ───────────────────────────────────────────────────
--
-- [เคส A — จ่ายเท่ายอดค้างจ่ายพอดี · ล้างเป็นศูนย์]
--   1) เปิด TR-TR58 → กด "ลงบัญชีวันเบิกเงิน" → TR_DRAWDOWN: Dr 1151101 / Cr 2142101 3,000,000
--   2) แท็บ Schedule → กด Post Period JE "ทุกงวด" → แต่ละใบ Dr 5512110 / Cr 2197109 (ตามวันจริง)
--        → รวมยอด 2197109 = A  (เช่น 90 วัน ≈ 36,986.31)
--   3) Repayment → เลือก TR-TR58 → เงินต้น 3,000,000 + ดอกเบี้ย = A → ลงบัญชี
--        ใบ REPAYMENT:  Dr 2142101 3,000,000 · Dr 2197109 = A (ล้างหมด · ไม่มีส่วนเกิน) · Cr 1001201 3,000,000+A
--   4) JE: 2142101 = 0 และ 2197109 = 0 → สัญญาเป็น Repaid
--
-- [เคส B — จ่ายเกินยอดค้างจ่าย (เคสที่ QA เจอ) · ต้อง split]
--   1) เปิด TR-TR58 → กด "ลงบัญชีวันเบิกเงิน"
--   2) แท็บ Schedule → กด Post Period JE "เฉพาะงวด 1" (งวดอื่นยังไม่ลง)
--        → TR_ACCRUED งวด 1: Cr 2197109 = B   (ยอดจริงตามวัน เช่น 9 วัน = 3,698.63)
--   3) Repayment → เลือก TR-TR58 → เงินต้น 3,000,000 + ดอกเบี้ย = C (ใส่ "มากกว่า" B เช่น 12,328.77) → ลงบัญชี
--        ใบ REPAYMENT (ต้องออกแบบนี้):
--          Dr 2142101  3,000,000.00
--          Dr 2197109  = B           ← เท่ายอด accrued จริง (เช่น 3,698.63)
--          Dr 5512110  = C − B       ← ส่วนเกินที่ยังไม่ตั้งค้างจ่าย (เช่น 12,328.77−3,698.63 = 8,630.14)
--          Cr 1001201  = 3,000,000 + C
--   4) JE: 2197109 ไม่ติดลบ (ล้างเหลือ 0) · ส่วนเกินเข้า P&L (5512110) ครบ · 2142101 = 0 → ปิด Repaid ได้
--
-- รันซ้ำได้ (ลบ JE → schedule → TR → CA → MA)
-- =====================================================================

-- ---------- cleanup (ลบ JE + ตัดชำระ + ตารางงวด ที่เคยทดสอบไปทั้งหมด) ----------
-- รองรับทุกกรณี: TR-TR58 จะมาจาก seed ไหนก็ได้ · ลบ drawdown / accrued / reversal / repayment ให้หมด
do $$
declare
  v_tr  uuid[];
  v_rep uuid[];
  v_je  uuid[];
begin
  select array_agg(id) into v_tr from trust_receipts where tr_no = 'TR-TR58';
  if v_tr is null then return; end if;

  -- ใบตัดชำระ (Repayment) ที่แตะสัญญานี้
  select array_agg(distinct repayment_id) into v_rep
    from repayment_lines where facility_id = any(v_tr);

  -- JE ที่ต้องลบ: ตั้งต้น TR (drawdown/accrued ทั้งใบตั้ง+ใบกลับ) + ใบ REPAYMENT
  select array_agg(id) into v_je from journal_entries
    where (source_id = any(v_tr) and source_type in ('TR_DRAWDOWN','TR_ACCRUED'))
       or (v_rep is not null and source_type = 'REPAYMENT' and source_id = any(v_rep));

  if v_je is not null then
    delete from je_lines where je_id = any(v_je);
    delete from journal_entries where id = any(v_je);
  end if;

  if v_rep is not null then
    delete from repayment_lines where repayment_id = any(v_rep);
    delete from repayments where id = any(v_rep);
  end if;

  delete from installment_schedules where facility_id = any(v_tr);
end $$;

delete from trust_receipts where tr_no = 'TR-TR58';
delete from credit_agreements where id = 'a5800000-0000-4000-8000-0000000000d1' or contract_number = 'CA-TR58-DEMO';
delete from ma_subsidiaries where ma_id = 'a5800000-0000-4000-8000-0000000000d2';
delete from master_agreements where id = 'a5800000-0000-4000-8000-0000000000d2' or ma_name = 'MA-TR58-DEMO';

-- ---------- ① MA + allocation ----------
insert into master_agreements
  (id, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization)
values
  ('a5800000-0000-4000-8000-0000000000d2','BBL','MA-TR58-DEMO','MGC','Approved',
   current_date - 90, current_date + 365, 50000000, 0);
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('a5800000-0000-4000-8000-0000000000d2','MGC',50000000,0,0);

-- ---------- ② CA (facility T/R) ----------
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary, facility_type_id, credit_line, currency,
   credit_type, finance_institution, start_date, end_date, status, rate_cards, acct_cards)
values
  ('a5800000-0000-4000-8000-0000000000d1','a5800000-0000-4000-8000-0000000000d2',
   'CA-TR58-DEMO (วงเงิน T/R)', 'CA-TR58-DEMO', 'MGC',
   (select id from facility_types where code='TR' limit 1),
   50000000, 'THB', 'Revolving', 'BBL',
   current_date - 90, current_date + 365, 'Approved',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},
     {"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},
     {"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial institutions"},
     {"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb);

-- ---------- ③ Trust Receipt · TR-TR58 · Active ----------
insert into trust_receipts
  (id, tr_no, name, ca_id, finance_institution, supplier, invoice_no, invoice_date,
   due_date, transaction_date, maturity_date, term_days, amount, currency,
   interest_rate_id, effective_rate, status, remark, rate_cards, acct_cards, created_at, updated_at)
values
  ('a5800000-0000-4000-8000-00000000a458','TR-TR58','TR-TR58 (ทดสอบตัดชำระ · split ดอกเบี้ย)',
   'a5800000-0000-4000-8000-0000000000d1','BBL','BMW (Thailand)', null, null,
   current_date + 60, current_date - 60, current_date + 30, 90, 3000000, 'THB',
   null, 5, 'Active',
   'seed TR-58 · ไหลครบวงจร เบิก→ดอกเบี้ย→ตัดชำระ · ใช้ทดสอบกฎ split ดอกเบี้ย',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb,
   '[{"id":"ac-1","type":"INVENTORY ACCOUNT","gl":"1151101 สินค้าคงเหลือ-ยานพาหนะ"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512110 ดอกเบี้ยจ่าย-Short term loan from financial institutions"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   now(), now());

-- ---------- ④ ตารางงวด (installment_schedules) · ให้ Repayment ดึงยอด Default รายงวด ----------
insert into installment_schedules
  (facility_type_id, facility_id, contract_no, period, due_date,
   begin_balance, principal, interest, fee, vat, payment, end_balance, paid, paid_amount)
values
  ((select id from facility_types where code='TR' limit 1),
   'a5800000-0000-4000-8000-00000000a458','TR-TR58', 1, current_date,
   3000000, 0, 12328.77, 0, 0, 12328.77, 3000000, false, 0),
  ((select id from facility_types where code='TR' limit 1),
   'a5800000-0000-4000-8000-00000000a458','TR-TR58', 2, current_date + 30,
   3000000, 0, 12328.77, 0, 0, 12328.77, 3000000, false, 0),
  ((select id from facility_types where code='TR' limit 1),
   'a5800000-0000-4000-8000-00000000a458','TR-TR58', 3, current_date + 60,
   3000000, 3000000, 12328.77, 0, 0, 3012328.77, 0, false, 0);
