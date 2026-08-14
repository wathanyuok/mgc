-- 0089: Approval Flow ครบทุกโมดูล — เพิ่ม 'Pending Approval' ใน enum ธุรกรรมทั้ง 8
-- + เติมค่าที่ขาด: lease_status/lc_status ต้องมี 'Cancelled' (ใช้ตอนปฏิเสธ)
-- รันซ้ำได้ (if not exists)

alter type lg_status    add value if not exists 'Pending Approval';
alter type fp_status    add value if not exists 'Pending Approval';
alter type od_status    add value if not exists 'Pending Approval';
alter type tr_status    add value if not exists 'Pending Approval';
alter type fxf_status   add value if not exists 'Pending Approval';
alter type loan_status  add value if not exists 'Pending Approval';
alter type lease_status add value if not exists 'Pending Approval';
alter type lc_status    add value if not exists 'Pending Approval';

alter type lease_status add value if not exists 'Cancelled';
alter type lc_status    add value if not exists 'Cancelled';
