-- 0094 — แก้รหัสสิทธิ์ของเมนูสัญญาเช่า
--
-- ปัญหาเดิม: seed ในไฟล์ 0064 ใส่รหัสว่า 'lease' ตัวเดียว
-- แต่หน้าจอจริงเช็คสิทธิ์ด้วย 'lease_hp' และ 'lease_other' → สิทธิ์ที่ seed ไว้ไม่มีผล
-- ตอนนี้แยกสัญญาเช่าเป็น 3 ชนิด จึงต้องมี 3 รหัส:
--   lease_hp      = Hire Purchase
--   lease_leasing = Leasing        (ของใหม่)
--   lease_other   = Leasing Other
--
-- ไฟล์นี้: แตกสิทธิ์ 'lease' เดิมออกเป็น 3 รหัสจริง แล้วลบรหัสเก่าทิ้ง
-- ถ้ากลุ่มไหนมี lease_hp / lease_other อยู่แล้ว จะไม่ถูกลดสิทธิ์ (คงค่าที่กว้างกว่าไว้)

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM group_permissions WHERE menu_key = 'lease' LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES
      (r.group_id, 'lease_hp',      r.can_view, r.can_edit, r.can_approve),
      (r.group_id, 'lease_leasing', r.can_view, r.can_edit, r.can_approve),
      (r.group_id, 'lease_other',   r.can_view, r.can_edit, r.can_approve)
    ON CONFLICT (group_id, menu_key) DO UPDATE SET
      can_view    = group_permissions.can_view    OR EXCLUDED.can_view,
      can_edit    = group_permissions.can_edit    OR EXCLUDED.can_edit,
      can_approve = group_permissions.can_approve OR EXCLUDED.can_approve;
  END LOOP;

  DELETE FROM group_permissions WHERE menu_key = 'lease';
END $$;

-- กลุ่มไหนเคยมีสิทธิ์ Leasing Other อยู่แล้ว ให้ได้ Leasing ตัวใหม่ในระดับเดียวกัน
-- (เพราะข้อมูลชุดเดิมที่ติ๊กว่าใช้สินเชื่อ ถูกย้ายมาเป็นชนิดนี้ใน 0093)
INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
SELECT group_id, 'lease_leasing', can_view, can_edit, can_approve
  FROM group_permissions WHERE menu_key = 'lease_other'
ON CONFLICT (group_id, menu_key) DO UPDATE SET
  can_view    = group_permissions.can_view    OR EXCLUDED.can_view,
  can_edit    = group_permissions.can_edit    OR EXCLUDED.can_edit,
  can_approve = group_permissions.can_approve OR EXCLUDED.can_approve;
