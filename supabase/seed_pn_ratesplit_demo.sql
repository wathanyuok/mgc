-- Seed: PN demo สำหรับทดสอบ multi-rate schedule (rate-segment split)
-- เคส: amount 100,000 · 2% เริ่ม 08/09/2026 · เปลี่ยนเป็น 5% เริ่ม 08/10/2026 · ครบ 07/11/2026
-- คาดหวังในแท็บ Schedule Calculate:
--   P1 08ก.ย.–30ก.ย. (22d) 2%   = 120.55
--   P2 30ก.ย.–31ต.ค. (31d) split = 358.90  (2% 8วัน 43.84 + 5% 23วัน 315.07)
--   P3 31ต.ค.–07พ.ย. (7d) 5%    = 95.89
--   รวมดอกเบี้ย = 575.34
-- รันซ้ำได้ (ลบของเดิมชื่อเดียวกันก่อน)

delete from promissory_notes where pn_number = 'PN-DEMO-001';

insert into promissory_notes
  (name, pn_number, finance_institution, facility_type_id, transaction_date, maturity_date, term_days, amount, currency, status, rate_cards)
values
  ('PN-DEMO-RATESPLIT', 'PN-DEMO-001', 'BBL',
   (select id from facility_types where code = 'PN' limit 1),
   '2026-09-08', '2026-11-07', 60, 100000, 'THB', 'Draft',
   '[
      {"id":"rc-1","type":"Fixed","rate":2,"condition":0,"start_date":"2026-09-08"},
      {"id":"rc-2","type":"Fixed","rate":5,"condition":0,"start_date":"2026-10-08"}
    ]'::jsonb);
