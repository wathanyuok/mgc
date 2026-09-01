-- ============================================================================
-- 0103 · เก็บประวัติการอนุมัติของสัญญาหลักและวงเงินย่อย
-- ============================================================================
--
-- ปัญหาเดิม
--   ตารางธุรกรรมทั้ง 9 ตารางมีช่องเก็บประวัติการอนุมัติมาตั้งแต่ 0060
--   แต่สัญญาหลัก (master_agreements) กับวงเงินย่อย (credit_agreements) ตกหล่นไป
--   มีแต่ช่องสถานะ ไม่ได้เก็บว่าใครส่งขออนุมัติ ใครอนุมัติ เมื่อไร
--
--   ผลที่ตามมา 2 อย่าง
--     1. ป้าย "ส่งโดยใคร · อนุมัติโดยใคร เมื่อไร" บนหน้าจอไม่มีทางขึ้น
--     2. ตรวจไม่ได้ว่าคนที่กดอนุมัติเป็นคนเดียวกับคนที่ส่งเรื่องมาหรือเปล่า
--        ซึ่งเป็นหัวใจของการแยกหน้าที่ผู้จัดทำกับผู้อนุมัติ
--
-- ไฟล์นี้เติมช่องชุดเดียวกับที่ 0060 ให้ 9 ตารางธุรกรรมไว้ ให้ครบทั้ง 11 ตาราง
-- เป็นคอลัมน์ที่อนุญาตให้ว่างได้ ข้อมูลเดิมไม่กระทบ
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['master_agreements', 'credit_agreements'] loop
    execute format($sql$
      alter table %I
        add column if not exists submitted_by     text,
        add column if not exists submitted_at     timestamptz,
        add column if not exists approved_by      text,
        add column if not exists approved_at      timestamptz,
        add column if not exists rejection_reason text
    $sql$, t);
  end loop;
end $$;

comment on column master_agreements.submitted_by is
  'ผู้จัดทำที่กดส่งขออนุมัติ · ว่าง = ยังไม่เคยส่ง';
comment on column master_agreements.submitted_at is
  'เวลาที่ส่งขออนุมัติ';
comment on column master_agreements.approved_by is
  'ผู้อนุมัติ · ต้องไม่ใช่คนเดียวกับ submitted_by ยกเว้นผู้ดูแลระบบ';
comment on column master_agreements.approved_at is
  'เวลาที่อนุมัติ';
comment on column master_agreements.rejection_reason is
  'เหตุผลตอนส่งกลับให้แก้ไขหรือปฏิเสธ';

comment on column credit_agreements.submitted_by is
  'ผู้จัดทำที่กดส่งขออนุมัติ · ว่าง = ยังไม่เคยส่ง';
comment on column credit_agreements.submitted_at is
  'เวลาที่ส่งขออนุมัติ';
comment on column credit_agreements.approved_by is
  'ผู้อนุมัติ · ต้องไม่ใช่คนเดียวกับ submitted_by ยกเว้นผู้ดูแลระบบ';
comment on column credit_agreements.approved_at is
  'เวลาที่อนุมัติ';
comment on column credit_agreements.rejection_reason is
  'เหตุผลตอนส่งกลับให้แก้ไขหรือปฏิเสธ';
