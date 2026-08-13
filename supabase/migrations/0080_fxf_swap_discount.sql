-- 0080: FX Forward — Swap Discount / Net Rate (BRD §2.8 เพิ่มเติม · L&L #3)
-- MGC บันทึก Swap Discount ที่ธนาคารให้ ณ Deal Date → ใช้คำนวณ Net Rate ตอนจ่ายจริง
--   Net Rate = Forward Rate + Swap Discount (เช่น 34.50 + (-0.10) = 34.40)
--   Full at Last Date = ใช้ discount เต็มเมื่อจ่าย ณ maturity
--   Pro-rate          = ปันส่วนตามจำนวนวันที่ใช้จริง (วันที่ใช้ / วันเต็มของสัญญา)
alter table fx_forwards
  add column if not exists swap_discount numeric(12, 6),
  add column if not exists discount_mode text
    check (discount_mode in ('full_at_last_date', 'pro_rate'));

comment on column fx_forwards.swap_discount is 'Swap Discount บาทต่อ 1 หน่วยเงินตราต่างประเทศ (เช่น -0.1) — ใช้คำนวณ Net Rate ตอนจ่ายจริง';
comment on column fx_forwards.discount_mode is 'full_at_last_date = discount เต็มเมื่อจ่าย ณ maturity · pro_rate = ปันส่วนตามวันใช้จริง';
