-- ============================================================
-- Seed: P/N Roll Over 2 แบบ · FIELD ครบทุกช่อง · สาย MA → CA → PN
--   แบบ 1 (ต่อวงเงินเดิม)  : ตัวใหม่ = เงื่อนไขเดิมเป๊ะ (ยอด/อัตราเท่าเดิม แค่ต่ออายุ)
--   แบบ 2 (ปรับแบบใหม่)     : ตัวใหม่ = ปรับยอด + อัตรา + อายุใหม่
-- โครง: PN ต้นฉบับ (status Roll Over) → PN ตัวใหม่ (Active, rollover_parent_id ชี้กลับต้นฉบับ)
-- รันซ้ำได้ (ลบตัวใหม่ก่อน แล้วค่อยลบต้นฉบับ · MA/CA ใช้ upsert)
-- ============================================================

-- ลบตัวใหม่ (child) ก่อน เพราะ FK rollover_parent_id ชี้ไปต้นฉบับ
delete from promissory_notes where pn_number in ('PN-RO1-NEW-001','PN-RO2-NEW-001');
delete from promissory_notes where pn_number in ('PN-RO1-ORIG-001','PN-RO2-ORIG-001');

-- ① MA
insert into master_agreements
  (id, ma_name, finance_institution, subsidiary, status, start_date, end_date,
   credit_line, utilization, guarantee_remark, inactive, remark, created_by, updated_by, created_at, updated_at)
values
  ('d9d9b000-0000-0000-0000-0000000000a1','MA-DEMO-PNRO','BBL','MGC','Approved',
   date '2026-01-01', date '2027-12-31', 50000000, 3200000,
   'ค้ำประกันแบบ Joint and Several เต็มวงเงิน', false, 'seed PN Rollover · MA ต้นสาย',
   (select id from app_users order by created_at limit 1),
   (select id from app_users order by created_at limit 1), now(), now())
on conflict (id) do update set status=excluded.status, credit_line=excluded.credit_line,
   utilization=excluded.utilization, remark=excluded.remark, updated_at=now();
delete from ma_subsidiaries where ma_id='d9d9b000-0000-0000-0000-0000000000a1';
insert into ma_subsidiaries (ma_id, subsidiary, credit_line, utilization, sort_order)
values ('d9d9b000-0000-0000-0000-0000000000a1','MGC',50000000,3200000,0);

-- ② CA (facility PN) · เปิด rollover ได้
insert into credit_agreements
  (id, ca_name, contract_number, ma_id, subsidiary, facility_type_id, credit_line, utilization,
   currency, credit_type, finance_institution, curtailment_option, rollover_max_times, rollover_max_days,
   loan_purpose, reference_contract, remark, guarantee_remark, rate_cards, acct_cards,
   start_date, end_date, status, created_by, updated_by, created_at, updated_at)
values
  ('d9d9b000-0000-0000-0000-0000000000c1','CA เดโม — วงเงิน P/N (Rollover)','CA-DEMO-PNRO',
   'd9d9b000-0000-0000-0000-0000000000a1','MGC',(select id from facility_types where code='PN' limit 1),
   20000000,3200000,'THB','Revolving','BBL',false,4,360,
   'วงเงินตั๋วสัญญาใช้เงินหมุนเวียน (รองรับ Roll Over)','REF-CA-PNRO-2026','seed PN Rollover · CA','ค้ำโดย MGC',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   date '2026-01-01', date '2027-12-31','Approved',
   (select id from app_users order by created_at limit 1),(select id from app_users order by created_at limit 1),now(),now())
on conflict (id) do update set facility_type_id=excluded.facility_type_id, rate_cards=excluded.rate_cards,
   acct_cards=excluded.acct_cards, rollover_max_times=excluded.rollover_max_times,
   rollover_max_days=excluded.rollover_max_days, status=excluded.status, updated_at=now();

-- ค่ากลาง acct_cards (ใช้ซ้ำทุก PN)
-- ⚠️ อยู่ใน insert แต่ละตัวด้านล่าง

-- =========================================================
-- CHAIN 1 · แบบ 1 (ต่อวงเงินเดิม)
-- ต้นฉบับ 01/06→01/09/2026 · 1,000,000 · 5%  → status Roll Over
-- ตัวใหม่  01/09→01/12/2026 · 1,000,000 · 5%  (เงื่อนไขเดิมเป๊ะ · แค่ต่ออายุ)
-- =========================================================
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id, transaction_date, maturity_date, term_days,
   amount, currency, interest_rate_id, effective_rate, reference_contract, po_ref, status, remark,
   rate_cards, acct_cards, chassis_list, rollover_parent_id, reference_transaction_id, accrued_interest, created_at, updated_at)
values
  ('d9d9b000-0000-0000-0000-000000000011','PN-RO1-ORIG','PN-RO1-ORIG-001',
   'd9d9b000-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-06-01', date '2026-09-01',92,1000000,'THB',null,5.0000,'REF-PN-RO1-ORIG','PO-PNRO1-ORIG',
   'Roll Over','seed · ต้นฉบับ ถูก Roll Over ไปตัวใหม่ (แบบต่อวงเงินเดิม)',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, null, null, 0, now(), now()),
  ('d9d9b000-0000-0000-0000-000000000012','PN-RO1-NEW','PN-RO1-NEW-001',
   'd9d9b000-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-09-01', date '2026-12-01',91,1000000,'THB',null,5.0000,'REF-PN-RO1-NEW','PO-PNRO1-NEW',
   'Active','seed · Roll Over แบบ 1 (ต่อวงเงินเดิม) · ยอด/อัตราเท่าเดิม แค่ต่ออายุ · rollover_parent = ORIG',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, 'd9d9b000-0000-0000-0000-000000000011', null, 0, now(), now());

-- =========================================================
-- CHAIN 2 · แบบ 2 (ปรับแบบใหม่)
-- ต้นฉบับ 01/06→01/09/2026 · 1,000,000 · 5%  → status Roll Over
-- ตัวใหม่  01/09/2026→01/03/2027 · 1,200,000 · 5.5% (ปรับยอด+อัตรา+อายุใหม่)
-- =========================================================
insert into promissory_notes
  (id, name, pn_number, ca_id, finance_institution, facility_type_id, transaction_date, maturity_date, term_days,
   amount, currency, interest_rate_id, effective_rate, reference_contract, po_ref, status, remark,
   rate_cards, acct_cards, chassis_list, rollover_parent_id, reference_transaction_id, accrued_interest, created_at, updated_at)
values
  ('d9d9b000-0000-0000-0000-000000000021','PN-RO2-ORIG','PN-RO2-ORIG-001',
   'd9d9b000-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-06-01', date '2026-09-01',92,1000000,'THB',null,5.0000,'REF-PN-RO2-ORIG','PO-PNRO2-ORIG',
   'Roll Over','seed · ต้นฉบับ ถูก Roll Over ไปตัวใหม่ (แบบปรับใหม่)',
   '[{"id":"rc-1","type":"Fixed","rate":5,"condition":0,"overlimit":0,"start_date":"2026-06-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, null, null, 0, now(), now()),
  ('d9d9b000-0000-0000-0000-000000000022','PN-RO2-NEW','PN-RO2-NEW-001',
   'd9d9b000-0000-0000-0000-0000000000c1','BBL',(select id from facility_types where code='PN' limit 1),
   date '2026-09-01', date '2027-03-01',181,1200000,'THB',null,5.5000,'REF-PN-RO2-NEW','PO-PNRO2-NEW',
   'Active','seed · Roll Over แบบ 2 (ปรับใหม่) · ยอด 1,000,000→1,200,000 · อัตรา 5%→5.5% · อายุใหม่ 181 วัน · rollover_parent = ORIG',
   '[{"id":"rc-1","type":"Fixed","rate":5.5,"condition":0,"overlimit":0,"start_date":"2026-09-01"}]'::jsonb,
   '[{"id":"ac-1","type":"CASH / BANK ACCOUNT","gl":"1001201 C/A - BBL#181-3-11063-0"},{"id":"ac-2","type":"NOTE PAYABLE ACCOUNT","gl":"2142101 เงินกู้ยืมระยะสั้น-สถาบันการเงิน"},{"id":"ac-3","type":"INTEREST EXPENSE ACCOUNT","gl":"5512109 ดอกเบี้ยจ่าย-PN"},{"id":"ac-4","type":"ACCRUED INTEREST ACCOUNT","gl":"2197109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน"}]'::jsonb,
   '[]'::jsonb, 'd9d9b000-0000-0000-0000-000000000021', null, 0, now(), now());

-- ตรวจผล
select pn_number, status, transaction_date, maturity_date, term_days, amount, effective_rate,
       rollover_parent_id is not null as is_rollover
  from promissory_notes
 where pn_number like 'PN-RO%'
 order by pn_number;
