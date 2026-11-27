-- 0151: ปล่อยให้ PO Ref ซ้ำได้ (ยกเลิกกฎ BR-PN-024 ห้ามซ้ำ)
--
-- ตาม MoM (PO lot): รถจาก PO ใบเดียวไม่ได้เข้าทีเดียว — ทยอยเข้าเป็น lot
--   แต่ละ lot เบิกเป็นรายการแยก (PN/FP/Loan) แต่อ้างอิง PO เดิม
--   → "PO ซ้ำในแบงก์เดียวกันได้ · PO ไม่ล็อก (ต่างจากเลขตัวถังที่ล็อกต่อแบงก์)"
--
-- เดิมบล็อกด้วย unique index 2 ชุด (0068 partial-active + 0083 full) + โค้ด assertPORefUnique
--   migration นี้ถอด index ทั้งหมด · ฝั่งโค้ดเอา assertPORefUnique ออกแล้ว (PORefImport.tsx)
--
-- Idempotent — รันซ้ำได้
drop index if exists uq_pn_po_ref;
drop index if exists uq_fp_po_ref;
drop index if exists uq_loan_po_ref;
drop index if exists uq_pn_po_ref_active;
drop index if exists uq_fp_po_ref_active;
drop index if exists uq_loan_po_ref_active;

comment on column promissory_notes.po_ref is 'เลข PO จาก NetSuite · ซ้ำได้ (PO เดียวทยอยเข้าหลาย lot) — ยกเลิก BR-PN-024 ตาม MoM';
comment on column floor_plans.po_ref      is 'เลข PO จาก NetSuite · ซ้ำได้ (PO เดียวทยอยเข้าหลาย lot) — ยกเลิก BR-PN-024 ตาม MoM';
comment on column loans.po_ref            is 'เลข PO จาก NetSuite · ซ้ำได้ (PO เดียวทยอยเข้าหลาย lot) — ยกเลิก BR-PN-024 ตาม MoM';
