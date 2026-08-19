-- =====================================================================
--  ข้อมูลทดสอบ Approval Flow (Maker / Checker)
--  -------------------------------------------------------------------
--  สร้างสัญญาตัวอย่างครบทุกขั้นของเส้นทางอนุมัติ เพื่อเปิดดูแล้วเห็น
--  ปุ่มและแบนเนอร์ต่างกันในแต่ละสถานะ
--
--    Draft             → เห็นปุ่ม "ส่งขออนุมัติ"
--    Pending Approval  → เห็นปุ่ม อนุมัติ / ส่งกลับแก้ / ปฏิเสธ (เฉพาะผู้มีสิทธิ์อนุมัติ)
--                        คนอื่นเห็นแบนเนอร์ "อยู่ระหว่างรอการอนุมัติ"
--    Approved/Active   → ไม่มีปุ่ม สัญญามีผลแล้ว
--    Rejected/Cancelled→ ไม่มีปุ่ม พร้อมเหตุผลที่ปฏิเสธในช่อง Remark
--    ส่งกลับแก้แล้ว     → กลับเป็น Draft พร้อมเหตุผลในช่อง Remark
--
--  รันใน Supabase SQL Editor · รันซ้ำได้ (ลบของเดิมที่ขึ้นต้น DEMO- ก่อน)
-- =====================================================================

-- ── ล้างชุดทดสอบเดิม ──
DELETE FROM promissory_notes  WHERE name    LIKE 'DEMO-PN-%';
DELETE FROM credit_agreements WHERE ca_name LIKE 'DEMO-CA-%';
DELETE FROM master_agreements WHERE ma_name LIKE 'DEMO-MA-%';

DO $$
DECLARE
  v_fi   TEXT := 'KBANK';
  v_sub  TEXT := 'MCR';
  v_ma   UUID;
  v_ca   UUID;
BEGIN

-- =====================================================================
-- 1) Master Agreement — 5 ใบ ครบทุกขั้น
-- =====================================================================
INSERT INTO master_agreements (finance_institution, ma_name, subsidiary, status,
                               start_date, end_date, credit_line, utilization, remark)
VALUES
  (v_fi, 'DEMO-MA-01 ร่าง',            v_sub, 'Draft',
   CURRENT_DATE, CURRENT_DATE + 365, 100000000, 0, NULL),

  (v_fi, 'DEMO-MA-02 รออนุมัติ',        v_sub, 'Pending Approval',
   CURRENT_DATE, CURRENT_DATE + 365, 200000000, 0, NULL),

  (v_fi, 'DEMO-MA-03 อนุมัติแล้ว',      v_sub, 'Approved',
   CURRENT_DATE - 30, CURRENT_DATE + 335, 300000000, 45000000, NULL),

  (v_fi, 'DEMO-MA-04 ส่งกลับแก้',       v_sub, 'Draft',
   CURRENT_DATE, CURRENT_DATE + 365, 150000000, 0,
   'ส่งกลับแก้: วงเงินไม่ตรงกับหนังสืออนุมัติของธนาคาร กรุณาตรวจสอบอีกครั้ง'),

  (v_fi, 'DEMO-MA-05 ปฏิเสธ',          v_sub, 'Rejected',
   CURRENT_DATE, CURRENT_DATE + 365, 50000000, 0,
   'ปฏิเสธ: เอกสารประกอบไม่ครบถ้วน ขาดหนังสือรับรองบริษัทและงบการเงินปีล่าสุด');

SELECT id INTO v_ma FROM master_agreements WHERE ma_name = 'DEMO-MA-03 อนุมัติแล้ว';

-- =====================================================================
-- 2) Credit Agreement — 5 ใบ ผูกกับ MA ที่อนุมัติแล้ว
-- =====================================================================
INSERT INTO credit_agreements (ma_id, ca_name, contract_number, subsidiary, facility_type,
                               finance_institution, credit_line, utilization,
                               start_date, end_date, status, credit_type, currency, remark)
VALUES
  (v_ma, 'DEMO-CA-01 ร่าง',       'DEMO-CT-001', v_sub, 'PN', v_fi, 20000000, 0,
   CURRENT_DATE, CURRENT_DATE + 365, 'Draft',            'Revolving', 'THB', NULL),

  (v_ma, 'DEMO-CA-02 รออนุมัติ',   'DEMO-CT-002', v_sub, 'PN', v_fi, 30000000, 0,
   CURRENT_DATE, CURRENT_DATE + 365, 'Pending Approval', 'Revolving', 'THB', NULL),

  (v_ma, 'DEMO-CA-03 อนุมัติแล้ว', 'DEMO-CT-003', v_sub, 'PN', v_fi, 40000000, 12000000,
   CURRENT_DATE - 20, CURRENT_DATE + 345, 'Approved',    'Revolving', 'THB', NULL),

  (v_ma, 'DEMO-CA-04 ส่งกลับแก้',  'DEMO-CT-004', v_sub, 'FP', v_fi, 25000000, 0,
   CURRENT_DATE, CURRENT_DATE + 365, 'Draft',            'Revolving', 'THB',
   'ส่งกลับแก้: ประเภทวงเงินไม่ตรงกับสัญญา กรุณาเปลี่ยนเป็น Floor Plan และแนบสัญญาฉบับจริง'),

  (v_ma, 'DEMO-CA-05 ปฏิเสธ',     'DEMO-CT-005', v_sub, 'OD', v_fi, 10000000, 0,
   CURRENT_DATE, CURRENT_DATE + 365, 'Rejected',         'Revolving', 'THB',
   'ปฏิเสธ: วงเงินรวมเกินกรอบที่สัญญาวงเงินหลักอนุมัติไว้');

SELECT id INTO v_ca FROM credit_agreements WHERE ca_name = 'DEMO-CA-03 อนุมัติแล้ว';

-- =====================================================================
-- 3) P/N — 5 ใบ (ฝั่งธุรกรรม ใช้ Active / Cancelled แทน Approved / Rejected)
-- =====================================================================
INSERT INTO promissory_notes (name, pn_number, ca_id, finance_institution, facility_type,
                              transaction_date, maturity_date, term_days,
                              amount, currency, effective_rate, status, remark)
VALUES
  ('DEMO-PN-01 ร่าง',        'DEMO-P001', v_ca, v_fi, 'PN',
   CURRENT_DATE, CURRENT_DATE + 90,  90, 5000000, 'THB', 4.5000, 'Draft', NULL),

  ('DEMO-PN-02 รออนุมัติ',    'DEMO-P002', v_ca, v_fi, 'PN',
   CURRENT_DATE, CURRENT_DATE + 90,  90, 7000000, 'THB', 4.5000, 'Pending Approval', NULL),

  ('DEMO-PN-03 อนุมัติแล้ว',  'DEMO-P003', v_ca, v_fi, 'PN',
   CURRENT_DATE - 10, CURRENT_DATE + 80, 90, 12000000, 'THB', 4.7500, 'Active', NULL),

  ('DEMO-PN-04 ส่งกลับแก้',   'DEMO-P004', v_ca, v_fi, 'PN',
   CURRENT_DATE, CURRENT_DATE + 60,  60, 3000000, 'THB', 4.5000, 'Draft',
   'ส่งกลับแก้: วันครบกำหนดเกินอายุวงเงินสินเชื่อ กรุณาปรับให้อยู่ในกรอบสัญญา'),

  ('DEMO-PN-05 ปฏิเสธ',      'DEMO-P005', v_ca, v_fi, 'PN',
   CURRENT_DATE, CURRENT_DATE + 90,  90, 9000000, 'THB', 4.5000, 'Cancelled',
   'ปฏิเสธ: ยอดเบิกทำให้วงเงินคงเหลือติดลบ');

END $$;

-- ── ตรวจผล ──
SELECT 'Master Agreement' AS โมดูล, ma_name AS ชื่อ, status::text AS สถานะ,
       COALESCE(LEFT(remark, 60), '—') AS เหตุผล
FROM master_agreements WHERE ma_name LIKE 'DEMO-MA-%'
UNION ALL
SELECT 'Credit Agreement', ca_name, status::text, COALESCE(LEFT(remark, 60), '—')
FROM credit_agreements WHERE ca_name LIKE 'DEMO-CA-%'
UNION ALL
SELECT 'P/N', name, status::text, COALESCE(LEFT(remark, 60), '—')
FROM promissory_notes WHERE name LIKE 'DEMO-PN-%'
ORDER BY 1, 2;
