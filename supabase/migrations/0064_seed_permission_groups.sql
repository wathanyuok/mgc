-- =====================================================================
-- Migration 0064 — Seed 5 default Permission Groups
-- =====================================================================
-- Ready-to-use groups aligned with roles named in the MoM Day 1 (line 189):
--   "เจ้าหน้าที่สินเชื่อ · เจ้าหน้าที่การเงิน · ผู้อนุมัติ (Maker/Checker)"
-- Plus 2 support roles (Accountant, Viewer) that MGC ops needs.
--
-- Admins can adjust per-user afterwards via Setting → Groups.
-- Idempotent: guarded by ON CONFLICT (name) DO NOTHING.
-- =====================================================================

BEGIN;

-- ── 1. Insert the 5 groups ────────────────────────────────────
INSERT INTO permission_groups (name, description, is_admin)
VALUES
  ('Credit Officer',   'เจ้าหน้าที่สินเชื่อ — เปิด / แก้ Loan / PN / LC / FP / OD / TR / LG / Lease · ส่งขออนุมัติได้ · ไม่ approve เอง', false),
  ('Finance Officer',  'เจ้าหน้าที่การเงิน — บันทึก Repayment / Drawdown / FX Forward · ยืนยันเงินโอน', false),
  ('Approver',         'ผู้อนุมัติ — ตรวจ + Approve / Request Changes ทุก facility', false),
  ('Accountant',       'บัญชี — Post JE, Reconcile, Adjust ต้น/ดอก, Netting', false),
  ('Viewer',           'ดูอย่างเดียว — อ่านได้ทุก tx แต่แก้ไม่ได้', false)
ON CONFLICT (name) DO NOTHING;

-- ── 2. Grant permissions for each group ─────────────────────
-- Menu keys used by can(menuKey, action): 'loan','pn','fp','od','tr','lg','lc','lease','fxf','repayment','je','bs','master'
--
-- Pattern:
--   Credit Officer  → edit ทุก facility (ไม่มี approve)
--   Finance Officer → edit repayment, drawdown, fxf
--   Approver        → approve ทุก facility
--   Accountant      → edit je + view all
--   Viewer          → view only

DO $$
DECLARE
  gid_credit UUID;
  gid_finance UUID;
  gid_approver UUID;
  gid_accountant UUID;
  gid_viewer UUID;
  menu_key TEXT;
BEGIN
  SELECT id INTO gid_credit     FROM permission_groups WHERE name = 'Credit Officer';
  SELECT id INTO gid_finance    FROM permission_groups WHERE name = 'Finance Officer';
  SELECT id INTO gid_approver   FROM permission_groups WHERE name = 'Approver';
  SELECT id INTO gid_accountant FROM permission_groups WHERE name = 'Accountant';
  SELECT id INTO gid_viewer     FROM permission_groups WHERE name = 'Viewer';

  -- Credit Officer: edit ทุก facility + view repayment/je/master
  FOREACH menu_key IN ARRAY ARRAY['loan','pn','fp','od','tr','lg','lc','lease','fxf'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_credit, menu_key, true, true, false)
    ON CONFLICT (group_id, menu_key) DO UPDATE
      SET can_view = true, can_edit = true, can_approve = false;
  END LOOP;
  FOREACH menu_key IN ARRAY ARRAY['repayment','je','bs','master'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_credit, menu_key, true, false, false)
    ON CONFLICT (group_id, menu_key) DO NOTHING;
  END LOOP;

  -- Finance Officer: edit repayment/fxf + view all
  FOREACH menu_key IN ARRAY ARRAY['repayment','fxf','bs'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_finance, menu_key, true, true, false)
    ON CONFLICT (group_id, menu_key) DO UPDATE
      SET can_view = true, can_edit = true, can_approve = false;
  END LOOP;
  FOREACH menu_key IN ARRAY ARRAY['loan','pn','fp','od','tr','lg','lc','lease','je','master'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_finance, menu_key, true, false, false)
    ON CONFLICT (group_id, menu_key) DO NOTHING;
  END LOOP;

  -- Approver: approve ทุก facility + view all
  FOREACH menu_key IN ARRAY ARRAY['loan','pn','fp','od','tr','lg','lc','lease','fxf'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_approver, menu_key, true, false, true)
    ON CONFLICT (group_id, menu_key) DO UPDATE
      SET can_view = true, can_approve = true;
  END LOOP;
  FOREACH menu_key IN ARRAY ARRAY['repayment','je','bs','master'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_approver, menu_key, true, false, false)
    ON CONFLICT (group_id, menu_key) DO NOTHING;
  END LOOP;

  -- Accountant: edit je + view all
  INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
  VALUES (gid_accountant, 'je', true, true, false)
  ON CONFLICT (group_id, menu_key) DO UPDATE
    SET can_view = true, can_edit = true;
  FOREACH menu_key IN ARRAY ARRAY['loan','pn','fp','od','tr','lg','lc','lease','fxf','repayment','bs','master'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_accountant, menu_key, true, false, false)
    ON CONFLICT (group_id, menu_key) DO NOTHING;
  END LOOP;

  -- Viewer: view only, everywhere
  FOREACH menu_key IN ARRAY ARRAY['loan','pn','fp','od','tr','lg','lc','lease','fxf','repayment','je','bs','master'] LOOP
    INSERT INTO group_permissions (group_id, menu_key, can_view, can_edit, can_approve)
    VALUES (gid_viewer, menu_key, true, false, false)
    ON CONFLICT (group_id, menu_key) DO NOTHING;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- Verify (run after apply)
-- =====================================================================
-- SELECT g.name, count(gp.id) AS perms_count,
--        sum(case when gp.can_edit then 1 else 0 end) AS edits,
--        sum(case when gp.can_approve then 1 else 0 end) AS approves
--   FROM permission_groups g
--   LEFT JOIN group_permissions gp ON gp.group_id = g.id
--  WHERE g.name IN ('Credit Officer','Finance Officer','Approver','Accountant','Viewer')
--  GROUP BY g.name
--  ORDER BY g.name;
