-- 0083: Auto Gen PO — PO Ref (NetSuite) บน PN / FP / Loan (BRD FR-FP-020/021 · L&L #1)
-- User พิมพ์เลข PO → กด "นำเข้าจาก NetSuite" → ระบบดึง PO record มาเติมฟอร์ม
-- BR-PN-024: ห้าม PO Ref ซ้ำ (unique ต่อตาราง)
alter table promissory_notes add column if not exists po_ref text;
alter table floor_plans      add column if not exists po_ref text;
alter table loans            add column if not exists po_ref text;

create unique index if not exists uq_pn_po_ref   on promissory_notes(po_ref) where po_ref is not null;
create unique index if not exists uq_fp_po_ref   on floor_plans(po_ref)      where po_ref is not null;
create unique index if not exists uq_loan_po_ref on loans(po_ref)            where po_ref is not null;

comment on column promissory_notes.po_ref is 'เลข PO จาก NetSuite ที่ใช้สร้างรายการนี้ (Auto Gen PO) · null = คีย์มือ';
