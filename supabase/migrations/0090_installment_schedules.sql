-- =====================================================================
--  ตารางผ่อนชำระกลาง (installment_schedules)
--  -------------------------------------------------------------------
--  ก่อนหน้านี้เก็บตารางผ่อนจริงแค่ 2 โมดูล (loan_schedules, lease_schedules)
--  ส่วน Floor Plan / P/N / T/R / O/D / L/C คำนวณสดตอนเปิดหน้าจอเท่านั้น
--  ทำให้ทำรายงานครบกำหนดชำระ · ค้างชำระ · แจ้งเตือนรายงวด ไม่ได้
--
--  ตารางนี้เก็บตารางผ่อนของทุกโมดูลไว้ที่เดียว อ้างสัญญาแบบ
--  (facility_type_id, facility_id) เหมือน repayments / bank_statement_lines
--
--  loan_schedules / lease_schedules ยังอยู่เหมือนเดิม — ตารางนี้เป็นสำเนา
--  สำหรับใช้ข้ามโมดูล (รายงาน · แจ้งเตือน) ไม่ได้แทนที่ของเดิม
-- =====================================================================

CREATE TABLE IF NOT EXISTS installment_schedules (
  id                UUID          NOT NULL DEFAULT uuid_generate_v4(),
  facility_type_id  UUID          NOT NULL REFERENCES facility_types(id),
  facility_id       UUID          NOT NULL,        -- soft FK — ชี้ไปตารางตามประเภทวงเงิน
  contract_no       TEXT,                          -- เลขที่สัญญา ณ เวลาที่สร้าง (กันสัญญาถูกลบแล้วตามไม่ได้)

  period            INT           NOT NULL,        -- งวดที่ 1, 2, 3...
  due_date          DATE          NOT NULL,        -- วันครบกำหนดชำระ

  begin_balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
  principal         NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest          NUMERIC(18,2) NOT NULL DEFAULT 0,
  fee               NUMERIC(18,2) NOT NULL DEFAULT 0,
  vat               NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment           NUMERIC(18,2) NOT NULL DEFAULT 0,   -- ยอดที่ต้องชำระงวดนี้
  end_balance       NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- ข้อมูลเฉพาะ Floor Plan (Curtailment = ทยอยคืนเงินต้นตามขั้น)
  curtail_days      INT,
  curtail_pct       NUMERIC(6,3),
  chassis_no        TEXT,                          -- ถ้าแยกตารางผ่อนรายคัน

  paid              BOOLEAN       NOT NULL DEFAULT FALSE,
  paid_date         DATE,
  paid_amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
  repayment_id      UUID,                          -- ผูกกับรายการชำระที่ตัดงวดนี้

  je_posted         BOOLEAN       NOT NULL DEFAULT FALSE,  -- ลงบัญชีดอกเบี้ยค้างจ่ายแล้วหรือยัง
  je_id             UUID,

  note              TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_installment_schedules PRIMARY KEY (id),
  CONSTRAINT uk_installment_schedules_period
    UNIQUE (facility_type_id, facility_id, period, chassis_no)
);

CREATE INDEX IF NOT EXISTS idx_inst_sched_facility
  ON installment_schedules(facility_type_id, facility_id, period);
CREATE INDEX IF NOT EXISTS idx_inst_sched_due
  ON installment_schedules(due_date) WHERE paid = FALSE;
CREATE INDEX IF NOT EXISTS idx_inst_sched_unpaid_overdue
  ON installment_schedules(due_date, paid);
CREATE INDEX IF NOT EXISTS idx_inst_sched_chassis
  ON installment_schedules(chassis_no) WHERE chassis_no IS NOT NULL;

COMMENT ON TABLE installment_schedules IS
  'ตารางผ่อนชำระของทุกโมดูลรวมที่เดียว — ใช้ทำรายงานครบกำหนด/ค้างชำระ และแจ้งเตือนรายงวด';
COMMENT ON COLUMN installment_schedules.facility_id IS
  'id ของสัญญาในตารางตามประเภทวงเงิน (soft FK — ไม่บังคับ referential integrity เพราะชี้ได้หลายตาราง)';
COMMENT ON COLUMN installment_schedules.chassis_no IS
  'ใช้เมื่อแยกตารางผ่อนรายคัน (Floor Plan) · NULL = ตารางระดับสัญญา';
COMMENT ON COLUMN installment_schedules.payment IS
  'ยอดที่ต้องชำระงวดนี้ = เงินต้น + ดอกเบี้ย + ค่าธรรมเนียม + ภาษี';

-- ── วันค้างชำระ + สถานะงวด (คำนวณให้ ไม่ต้องคิดซ้ำในโค้ด) ──
CREATE OR REPLACE VIEW installment_schedule_status AS
SELECT
  s.*,
  ft.code AS facility_code,
  ft.name_en AS facility_name,
  CASE
    WHEN s.paid THEN 0
    ELSE GREATEST(0, (CURRENT_DATE - s.due_date))
  END AS overdue_days,
  CASE
    WHEN s.paid THEN 'Paid'
    WHEN s.due_date < CURRENT_DATE THEN 'Overdue'
    WHEN s.due_date <= CURRENT_DATE + 30 THEN 'Due Soon'
    ELSE 'Future'
  END AS period_status
FROM installment_schedules s
JOIN facility_types ft ON ft.id = s.facility_type_id;

COMMENT ON VIEW installment_schedule_status IS
  'ตารางผ่อน + จำนวนวันค้างชำระ + สถานะงวด (Paid / Overdue / Due Soon / Future)';

-- ── RLS ──
ALTER TABLE installment_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_installment_schedules" ON installment_schedules;
CREATE POLICY "anon_all_installment_schedules" ON installment_schedules
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── อัปเดต updated_at อัตโนมัติ ──
CREATE OR REPLACE FUNCTION touch_installment_schedules()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_installment_schedules ON installment_schedules;
CREATE TRIGGER trg_touch_installment_schedules
  BEFORE UPDATE ON installment_schedules
  FOR EACH ROW EXECUTE FUNCTION touch_installment_schedules();
