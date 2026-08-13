-- 0082: LC Split — การรับมอบแบบทยอย (BRD §2.9 · L&L #2)
-- LC 1 ฉบับสั่งซื้อหลายคัน ผู้ขายส่งเป็น lot → สร้าง sub-LC ต่อ lot ที่รับจริง
-- LC ตัวแม่ยัง Open จนกว่ารับครบ · Fee ของแต่ละ sub คำนวณตาม maturity ของตัวเอง
alter table letters_of_credit
  add column if not exists parent_lc_id uuid references letters_of_credit(id) on delete set null;

create index if not exists idx_lc_parent on letters_of_credit(parent_lc_id) where parent_lc_id is not null;

comment on column letters_of_credit.parent_lc_id is 'FK → LC ตัวแม่ (กรณีเป็น sub-LC จากการรับมอบแบบทยอย) · null = LC ปกติ/ตัวแม่';
