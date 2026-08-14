-- 0087: Approval Flow — เพิ่มสถานะ 'Pending Approval' ใน enum ของ MA / CA / P/N (นำร่อง)
-- + เติมค่าที่ขาดตาม UI: ca_status ต้องมี 'Rejected' · pn_status ต้องมี 'Active'
-- รันซ้ำได้ (if not exists)

alter type ma_status add value if not exists 'Pending Approval';

alter type ca_status add value if not exists 'Pending Approval';
alter type ca_status add value if not exists 'Rejected';

alter type pn_status add value if not exists 'Pending Approval';
alter type pn_status add value if not exists 'Active';
