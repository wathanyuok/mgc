-- 0050_seed_segment_masters.sql
-- Seed mock data for Financial Segment Master tables
-- Per MoM_Loan_Lease_Workshop §6 — รอ MGC ส่งข้อมูลจริงแทน
--
-- ตัวอย่างค่าจากประชุม + DOMP/MGC structure ทั่วไป
-- Admin/dev ลบทิ้ง/แก้ได้

-- =====================================================================
-- SUBSIDIARIES — บริษัทในกลุ่ม MGC (จากประชุม + MoM phase 1+2)
-- =====================================================================
INSERT INTO subsidiaries (code, name, tax_id, netsuite_subsidiary_id, active)
VALUES
  ('MGC',  'Millennium Auto Group Co., Ltd.',         '0105540000111', 'NS-SUB-001', TRUE),
  ('MCR',  'Master Car Rental Co., Ltd.',             '0105540000222', 'NS-SUB-002', TRUE),
  ('MA',   'Millennium Auto Co., Ltd.',               '0105540000333', 'NS-SUB-003', TRUE),
  ('MTC',  'Master Trade Co., Ltd.',                  '0105540000444', 'NS-SUB-004', TRUE),
  ('NEO',  'NEO Holding Co., Ltd.',                   '0105540000555', NULL,         TRUE),
  ('SEER', 'Seer EV (Thailand) Co., Ltd.',            '0105541000111', 'NS-SUB-005', TRUE),
  ('XMT',  'XX Mobility Thailand Co., Ltd.',          '0105541000222', 'NS-SUB-006', TRUE),
  ('XMP',  'XX Motors Power Co., Ltd.',               '0105541000333', NULL,         TRUE),
  ('SUMM', 'Summit Auto Co., Ltd.',                   '0105542000111', NULL,         TRUE),
  ('DRV',  'Driver Co., Ltd.',                        '0105542000222', NULL,         TRUE)
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- DEPARTMENTS — แผนกใน MGC
-- =====================================================================
INSERT INTO departments (code, name, netsuite_department_id, active)
VALUES
  ('ACCT',   'Accounting',         'NS-DEPT-001', TRUE),
  ('FIN',    'Finance',            'NS-DEPT-002', TRUE),
  ('SALES',  'Sales',              'NS-DEPT-003', TRUE),
  ('MKT',    'Marketing',          'NS-DEPT-004', TRUE),
  ('HR',     'Human Resources',    'NS-DEPT-005', TRUE),
  ('IT',     'Information Technology', 'NS-DEPT-006', TRUE),
  ('LEGAL',  'Legal',              'NS-DEPT-007', TRUE),
  ('PROC',   'Procurement',        'NS-DEPT-008', TRUE),
  ('ADMIN',  'Administration',     NULL,          TRUE)
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- LOCATIONS — สาขา (อ้างอิง subsidiaries.id เป็น optional)
-- =====================================================================
INSERT INTO locations (code, name, subsidiary_id, netsuite_location_id, active)
SELECT 'HQ',         'Head Office (Bangkok)',  s.id, 'NS-LOC-001', TRUE FROM subsidiaries s WHERE s.code='MGC'
UNION ALL
SELECT 'BKK-RAMA9',  'Rama 9 Showroom',        s.id, 'NS-LOC-002', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'BKK-PHA',    'Phaholyothin Branch',    s.id, 'NS-LOC-003', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'BKK-BANG',   'Bangna Branch',          s.id, 'NS-LOC-004', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'BKK-LATPH',  'Lat Phrao Branch',       s.id, 'NS-LOC-005', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'BKK-RANG',   'Rangsit Branch',         s.id, 'NS-LOC-006', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'CNX',        'Chiang Mai Branch',      s.id, 'NS-LOC-007', TRUE FROM subsidiaries s WHERE s.code='MA'
UNION ALL
SELECT 'HKT',        'Phuket Branch',          NULL, NULL,         TRUE
UNION ALL
SELECT 'WHSE-BKK',   'BKK Warehouse',          NULL, 'NS-LOC-008', TRUE
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- CLASSES — Business Class (Direct Sales, Wholesale, etc.)
-- =====================================================================
INSERT INTO classes (code, name, netsuite_class_id, active)
VALUES
  ('DIRSALE', 'Direct Sales',  'NS-CLS-001', TRUE),
  ('WHSALE',  'Wholesale',     'NS-CLS-002', TRUE),
  ('FLEET',   'Fleet Rental',  'NS-CLS-003', TRUE),
  ('TRADE',   'Trading',       'NS-CLS-004', TRUE),
  ('RETAIL',  'Retail',        'NS-CLS-005', TRUE),
  ('SVCE',    'Service',       NULL,         TRUE)
ON CONFLICT (code) DO NOTHING;

-- Show count after insert
DO $$
DECLARE
  v_sub INTEGER; v_dept INTEGER; v_loc INTEGER; v_cls INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_sub  FROM subsidiaries;
  SELECT COUNT(*) INTO v_dept FROM departments;
  SELECT COUNT(*) INTO v_loc  FROM locations;
  SELECT COUNT(*) INTO v_cls  FROM classes;
  RAISE NOTICE 'Segment Master seed: % subsidiaries, % departments, % locations, % classes',
    v_sub, v_dept, v_loc, v_cls;
END $$;
