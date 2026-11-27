-- =====================================================================
-- Seed: ทดสอบ "วันที่ MA/CA ต้องครอบคลุมวันทำรายการ" (หน้า Promissory Note)
--
--   MA-COVER   : SCB · MGC · Approved · ครอบคลุมกว้าง (−60 .. +300)
--   MA-EXPIRED : SCB · MGC · Approved · หมดอายุแล้ว (−90 .. −5)
--
--   ใต้ MA-COVER:
--     CA-DATE-OK      : (−10 .. +20)  → ครอบคลุมวันนี้ → เห็นใน dropdown PN ✔
--     CA-DATE-EXPIRED : (−40 .. −10)  → หมดอายุไปแล้ว → ไม่เห็นใน dropdown ✘
--     CA-DATE-FUTURE  : (+10 .. +40)  → ยังไม่เริ่ม     → ไม่เห็นใน dropdown ✘
--   ใต้ MA-EXPIRED:
--     CA-MA-EXPIRED   : CA (−10 .. +20) ครอบคลุมวันนี้ แต่ MA หมดอายุ
--                       → เห็นใน dropdown (กรองแค่ CA) แต่กด Save ไม่ผ่าน (MA block) ⚠
--
-- วิธีทดสอบ:
--   1) เปิด New Promissory Note (วันที่ default = วันนี้)
--   2) เลือกธนาคาร SCB → ดู dropdown CREDIT AGREEMENT:
--        เห็น  CA-DATE-OK, CA-MA-EXPIRED
--        ไม่เห็น CA-DATE-EXPIRED, CA-DATE-FUTURE
--   3) เลือก CA-DATE-OK → แก้ TRANSACTION DATE เป็นอดีตไกลๆ → ขึ้นเตือนแดง + Save ไม่ผ่าน
--   4) เลือก CA-MA-EXPIRED → กด Save → บล็อกเพราะ MA หมดอายุ
--
-- รันซ้ำได้ (idempotent)
-- =====================================================================

-- cleanup (ลบ CA ก่อน MA เพราะ FK)
delete from credit_agreements where contract_number in
  ('CA-DATE-OK','CA-DATE-EXPIRED','CA-DATE-FUTURE','CA-MA-EXPIRED');
delete from master_agreements where ma_name in ('MA-COVER','MA-EXPIRED');

-- ① Master Agreements
insert into master_agreements
  (id, inactive, finance_institution, ma_name, subsidiary, status, start_date, end_date, credit_line, utilization, remark)
values
  ('dcad0001-0000-0000-0000-0000000000a1', false, 'SCB', 'MA-COVER',   'MGC', 'Approved', current_date - 60, current_date + 300, 50000000, 0, 'seed · MA ครอบคลุมกว้าง'),
  ('dcad0001-0000-0000-0000-0000000000a2', false, 'SCB', 'MA-EXPIRED', 'MGC', 'Approved', current_date - 90, current_date - 5,   50000000, 0, 'seed · MA หมดอายุแล้ว');

-- ② Credit Agreements (facility = P/N · SCB · MGC · Approved · THB)
insert into credit_agreements
  (id, ma_id, ca_name, contract_number, subsidiary,
   facility_type_id, credit_line, utilization,
   start_date, end_date, status, currency, credit_type, finance_institution,
   conversion_date, conversion_rate, fx_rate, fx_rate_date,
   curtailment_option, loan_purpose, reference_contract,
   rollover_max_days, rollover_max_times, rate_cards, acct_cards, remark)
select v.id, v.ma_id, v.ca_name, v.ca_name, 'MGC',
   coalesce((select id from facility_types where upper(code) in ('PN','P/N') limit 1),
            (select id from facility_types order by code limit 1)),
   10000000, 0,
   v.start_date, v.end_date, 'Approved', 'THB', 'Revolving', 'SCB',
   null, null, null, null,
   false, 'seed ทดสอบวันที่', null,
   90, 3, '[]'::jsonb, '[]'::jsonb, v.remark
from (values
  ('dcad0001-0000-0000-0000-0000000000c1'::uuid, 'dcad0001-0000-0000-0000-0000000000a1'::uuid, 'CA-DATE-OK',      current_date - 10, current_date + 20, 'seed · CA ครอบคลุมวันนี้ → เห็น'),
  ('dcad0001-0000-0000-0000-0000000000c2'::uuid, 'dcad0001-0000-0000-0000-0000000000a1'::uuid, 'CA-DATE-EXPIRED', current_date - 40, current_date - 10, 'seed · CA หมดอายุ → ไม่เห็น'),
  ('dcad0001-0000-0000-0000-0000000000c3'::uuid, 'dcad0001-0000-0000-0000-0000000000a1'::uuid, 'CA-DATE-FUTURE',  current_date + 10, current_date + 40, 'seed · CA ยังไม่เริ่ม → ไม่เห็น'),
  ('dcad0001-0000-0000-0000-0000000000c4'::uuid, 'dcad0001-0000-0000-0000-0000000000a2'::uuid, 'CA-MA-EXPIRED',   current_date - 10, current_date + 20, 'seed · CA ok แต่ MA หมดอายุ → Save ไม่ผ่าน')
) as v(id, ma_id, ca_name, start_date, end_date, remark);

-- ③ ตรวจผล
select m.ma_name, m.start_date as ma_start, m.end_date as ma_end, m.status as ma_status,
       c.contract_number as ca, c.start_date as ca_start, c.end_date as ca_end, c.status as ca_status,
       case when current_date between c.start_date and c.end_date then 'เห็นใน dropdown' else 'ไม่เห็น' end as dropdown_today
from credit_agreements c
join master_agreements m on m.id = c.ma_id
where c.contract_number in ('CA-DATE-OK','CA-DATE-EXPIRED','CA-DATE-FUTURE','CA-MA-EXPIRED')
order by c.contract_number;
