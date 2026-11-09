-- เพิ่มธนาคาร Mizuho ลง Bank Master (Vendor Master · vendor_type = 'bank')
-- code = 'BANK-MIZUHO' → fetchBankCodes() ตัด prefix 'BANK-' เหลือ 'MIZUHO'
-- ตรงกับค่าที่ parser Mizuho คืน (bank: 'MIZUHO') · ฟอร์มบน FINANCE INSTITUTION จะโชว์ 'MIZUHO'
-- idempotent — รันซ้ำได้

insert into vendors (code, name, vendor_type, fi_type, active)
select 'BANK-MIZUHO', 'ธนาคารมิซูโฮ แบงก์ จำกัด สาขากรุงเทพฯ', 'bank', 'Bank', true
where not exists (select 1 from vendors where code = 'BANK-MIZUHO');

-- ตรวจผล
select code, name, vendor_type, fi_type, active
from vendors
where vendor_type = 'bank'
order by code;
