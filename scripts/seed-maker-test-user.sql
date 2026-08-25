-- สร้างกลุ่มสิทธิ์ "Maker (ทดสอบ)" + user ทดสอบ สำหรับทดสอบ Approval Flow
-- รันใน Supabase SQL Editor · รันซ้ำได้ (idempotent)
-- ผลลัพธ์: user "maker@test.local" — สร้าง/แก้ MA·CA·P/N ได้ แต่อนุมัติเองไม่ได้

DO $$
DECLARE
  v_gid uuid;
BEGIN
  -- 1. กลุ่ม Maker (ทดสอบ)
  SELECT id INTO v_gid FROM permission_groups WHERE name = 'Maker (ทดสอบ)';
  IF v_gid IS NULL THEN
    INSERT INTO permission_groups (name, description, is_admin)
    VALUES ('Maker (ทดสอบ)', 'ทดสอบ Approval Flow — แก้ไขได้ อนุมัติไม่ได้', FALSE)
    RETURNING id INTO v_gid;
  END IF;

  -- 2. สิทธิ์: ma/ca/pn = view+edit (ไม่มี approve) · เมนูอื่น = view อย่างเดียว
  INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
  SELECT v_gid, k, TRUE, (k IN ('ma','ca','pn')), FALSE
  FROM unnest(ARRAY[
    'dashboard','reports','ma','ca','pn','lg','lc','fp','od','tr','fxf','loan','repayment',
    'lease_hp','lease_leasing','lease_other','je','master_interest','master_curtailment','master_bank','master_coa','notifications'
  ]) AS k
  ON CONFLICT (group_id, menu_key)
  DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit, can_approve = EXCLUDED.can_approve;

  -- 3. user ทดสอบ
  INSERT INTO app_users (name, email, group_id, status)
  VALUES ('Maker ทดสอบ', 'maker@test.local', v_gid, 'Active')
  ON CONFLICT (email) DO UPDATE SET group_id = v_gid, status = 'Active';
END $$;
