-- 0048_seed_vendors.sql
-- Seed mock vendor data for LookupVendorModal testing (Phase 1 stub mode)
-- Per MoM Interface §3 — Vendor Master ที่ NetSuite เป็น source of truth
-- ตัวอย่างนี้ใช้ตอนยังไม่มี NetSuite Lookup API จริง · admin/dev ลบทิ้ง/แก้ได้ตามต้องการ
--
-- Coverage:
--   • Lessors (IFRS 16) — บริษัท leasing ที่ใช้จริงในงาน MGC
--   • Banks — สถาบันการเงินที่ใช้ในงาน MGC (SCB, KBANK, BBL ฯลฯ)
--   • Suppliers — ตัวอย่างเล็กน้อยสำหรับ Floor Plan / TR

INSERT INTO vendors (code, name, tax_id, vendor_type, netsuite_vendor_id, contact_email, contact_phone, active)
VALUES
  -- ===== Lessors (IFRS 16 Lease — บริษัท leasing) =====
  ('LESSOR-BMW', 'BMW Leasing (Thailand) Co., Ltd.', '0105543000123', 'lessor',
   'NS-V-1001', 'lease@bmw-leasing.co.th', '02-650-9999', TRUE),
  ('LESSOR-HONDA', 'Honda Leasing (Thailand) Co., Ltd.', '0105543000456', 'lessor',
   'NS-V-1002', 'lease@honda-leasing.co.th', '02-714-8888', TRUE),
  ('LESSOR-TOYOTA', 'Toyota Leasing (Thailand) Co., Ltd.', '0105543000789', 'lessor',
   'NS-V-1003', 'lease@toyota-leasing.co.th', '02-396-3000', TRUE),
  ('LESSOR-MITSUBISHI', 'Mitsubishi Motors Leasing (TH)', '0105546000111', 'lessor',
   NULL, 'lease@mitsubishi-leasing.co.th', '02-739-6000', TRUE),  -- ยังไม่ map (สำหรับ test warning)
  ('LESSOR-AP-PROPERTY', 'บริษัท เอ.พี. พร็อพเพอร์ตี้ จำกัด', '0105541000222', 'lessor',
   'NS-V-1004', 'lease@ap-property.co.th', '02-261-2000', TRUE),
  ('LESSOR-CENTRAL', 'บริษัท เซ็นทรัล เรียลตี้ จำกัด', '0105540000333', 'lessor',
   'NS-V-1005', 'lease@central-realty.co.th', '02-118-7000', TRUE),

  -- ===== Banks (PN/FP/OD/TR/LG counterparties) =====
  ('BANK-SCB', 'ธนาคารไทยพาณิชย์ จำกัด (มหาชน)', '0107536001249', 'bank',
   'NS-V-2001', 'corporate@scb.co.th', '02-544-1000', TRUE),
  ('BANK-KBANK', 'ธนาคารกสิกรไทย จำกัด (มหาชน)', '0107536000293', 'bank',
   'NS-V-2002', 'corporate@kbank.co.th', '02-888-8888', TRUE),
  ('BANK-BBL', 'ธนาคารกรุงเทพ จำกัด (มหาชน)', '0107536000048', 'bank',
   'NS-V-2003', 'corporate@bangkokbank.com', '02-645-5555', TRUE),
  ('BANK-KTB', 'ธนาคารกรุงไทย จำกัด (มหาชน)', '0107537000882', 'bank',
   'NS-V-2004', 'corporate@ktb.co.th', '02-111-1111', TRUE),
  ('BANK-BAY', 'ธนาคารกรุงศรีอยุธยา จำกัด (มหาชน)', '0107536000692', 'bank',
   'NS-V-2005', 'corporate@krungsri.com', '02-296-2000', TRUE),
  ('BANK-TTB', 'ธนาคารทหารไทยธนชาต จำกัด (มหาชน)', '0107562000114', 'bank',
   'NS-V-2006', 'corporate@ttbbank.com', '02-299-1111', TRUE),
  ('BANK-UOB', 'ธนาคารยูโอบี จำกัด (มหาชน)', '0107536000455', 'bank',
   'NS-V-2007', 'corporate@uob.co.th', '02-343-3000', TRUE),
  ('BANK-BMW-FS', 'BMW Financial Services Thailand', '0105543000666', 'bank',
   NULL, 'finance@bmw.co.th', '02-305-8888', TRUE),  -- ยังไม่ map

  -- ===== Suppliers / Dealers (FP / TR) =====
  ('SUP-GOODWOOD', 'บริษัท กู๊ดวูด ออโต้เวอร์ค จำกัด', '0105547001234', 'supplier',
   'NS-V-3001', 'sales@goodwood.co.th', '02-712-3456', TRUE),
  ('SUP-AUTO-DIST', 'Auto Distribution (Thailand) Co., Ltd.', '0105549001234', 'dealer',
   'NS-V-3002', 'sales@autodist.co.th', '02-555-1234', TRUE),
  ('IMP-LUXURY-CARS', 'Luxury Cars Imports', '0105550001234', 'importer',
   'NS-V-3003', 'sales@luxurycars.co.th', '02-666-1234', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Show count after insert
DO $$
DECLARE
  v_lessor_count INTEGER;
  v_bank_count INTEGER;
  v_other_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_lessor_count FROM vendors WHERE vendor_type = 'lessor';
  SELECT COUNT(*) INTO v_bank_count FROM vendors WHERE vendor_type = 'bank';
  SELECT COUNT(*) INTO v_other_count FROM vendors WHERE vendor_type IN ('supplier', 'dealer', 'importer');
  RAISE NOTICE 'Vendor seed complete: % lessors, % banks, % suppliers/dealers/importers',
    v_lessor_count, v_bank_count, v_other_count;
END $$;
