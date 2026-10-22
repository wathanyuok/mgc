-- =====================================================================
-- Seed: Repayment Report แสดงหลายสกุล (USD / EUR) เพื่อทดสอบ subtotal แยกสกุล
-- =====================================================================
-- Repayment Report อ่าน: repayments + จับคู่ธุรกรรม (reference_no = เลขที่สัญญา)
--   → currency มาจาก "สัญญา" (promissory_notes.currency) ไม่ใช่จากตัว repayment
-- สร้าง 2 ตั๋ว P/N สกุลต่างประเทศ + rายการชำระอ้างอิง
--   PN-USD-DEMO (USD) · PN-EUR-DEMO (EUR)
-- ยอด principal/interest ใน repayments = ยอดในสกุลนั้น ๆ
-- รันซ้ำได้
-- =====================================================================

-- cleanup
delete from repayments where reference_no in ('PN-USD-DEMO','PN-EUR-DEMO');
delete from promissory_notes where pn_number in ('PN-USD-DEMO','PN-EUR-DEMO');

-- ── ตั๋ว P/N สกุล USD ────────────────────────────────────────────────
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution,
   transaction_date, maturity_date, term_days,
   amount, currency, status, rate_cards)
values
  ('f0f00000-0000-4000-8000-00000000d501'::uuid,
   'PN-USD-DEMO', 'PN-USD-DEMO',
   (select id from credit_agreements where status='Approved' order by created_at limit 1),
   (select id from facility_types where code='PN' limit 1), 'SCB',
   current_date - 60, current_date + 30, 90,
   50000, 'USD', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- ── ตั๋ว P/N สกุล EUR ────────────────────────────────────────────────
insert into promissory_notes
  (id, name, pn_number, ca_id, facility_type_id, finance_institution,
   transaction_date, maturity_date, term_days,
   amount, currency, status, rate_cards)
values
  ('f0f00000-0000-4000-8000-00000000e401'::uuid,
   'PN-EUR-DEMO', 'PN-EUR-DEMO',
   (select id from credit_agreements where status='Approved' order by created_at limit 1),
   (select id from facility_types where code='PN' limit 1), 'KBANK',
   current_date - 45, current_date + 45, 90,
   30000, 'EUR', 'Active',
   '[{"id":"rc-1","type":"Fixed","rate":4,"condition":0,"overlimit":0,"start_date":null}]'::jsonb);

-- ── รายการชำระ (ยอดในสกุลต่างประเทศ) ────────────────────────────────
-- USD: 2 งวด · EUR: 2 งวด
insert into repayments
  (id, repayment_no, facility_type_id, facility_id, pay_date, amount, principal, interest,
   fee, vat, wht, penalty, channel, payment_type, reference_no, remark, status)
values
  ('f0f00000-0000-4000-8000-00000000d5a1'::uuid,'RP-USD-DEMO-1',
   (select id from facility_types where code='PN' limit 1),'f0f00000-0000-4000-8000-00000000d501'::uuid,
   current_date - 30, 25208.33, 25000, 208.33, 0,0,0,0,'Bank Statement', null,'PN-USD-DEMO',
   'seed FX repayment · USD งวด 1', 'Posted'),
  ('f0f00000-0000-4000-8000-00000000d5a2'::uuid,'RP-USD-DEMO-2',
   (select id from facility_types where code='PN' limit 1),'f0f00000-0000-4000-8000-00000000d501'::uuid,
   current_date - 1, 25104.17, 25000, 104.17, 0,0,0,0,'Bank Statement', null,'PN-USD-DEMO',
   'seed FX repayment · USD งวด 2', 'Posted'),
  ('f0f00000-0000-4000-8000-00000000e4a1'::uuid,'RP-EUR-DEMO-1',
   (select id from facility_types where code='PN' limit 1),'f0f00000-0000-4000-8000-00000000e401'::uuid,
   current_date - 20, 15100.00, 15000, 100.00, 0,0,0,0,'Bank Statement', null,'PN-EUR-DEMO',
   'seed FX repayment · EUR งวด 1', 'Posted'),
  ('f0f00000-0000-4000-8000-00000000e4a2'::uuid,'RP-EUR-DEMO-2',
   (select id from facility_types where code='PN' limit 1),'f0f00000-0000-4000-8000-00000000e401'::uuid,
   current_date - 2, 15050.00, 15000, 50.00, 0,0,0,0,'Bank Statement', null,'PN-EUR-DEMO',
   'seed FX repayment · EUR งวด 2', 'Posted');

-- ตรวจผล
select r.reference_no, pn.currency, r.principal, r.interest
from repayments r join promissory_notes pn on pn.pn_number = r.reference_no
where r.reference_no in ('PN-USD-DEMO','PN-EUR-DEMO') order by r.reference_no, r.pay_date;
