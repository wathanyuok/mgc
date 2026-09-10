-- Seed: PN demo สำหรับลองกดปุ่มลงบัญชี (Drawdown JE + ดอกเบี้ยรายงวด)
-- ตั๋วสถานะ Active → ปุ่ม "ลงบัญชีวันเบิกเงิน" กดได้ทันที
-- เงินต้น 1,000,000 · 5% · 01/09/2026 → 01/12/2026 (มี 3 งวด ให้ลองลงดอกเบี้ยรายงวด)
-- รันซ้ำได้ (ลบของเดิมชื่อเดียวกันก่อน)

delete from promissory_notes where pn_number = 'PN-DEMO-JE-001';

insert into promissory_notes
  (name, pn_number, finance_institution, facility_type_id, transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('PN-DEMO-JE', 'PN-DEMO-JE-001', 'BBL',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-09-01', '2026-12-01', 91, 1000000, 'THB', 'Active',
   '[
      {"id":"rc-1","type":"Fixed","rate":5,"condition":0,"start_date":"2026-09-01"}
    ]'::jsonb);
