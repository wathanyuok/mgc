-- =====================================================================
--  ทะเบียนรถกลาง (vehicles)
--  -------------------------------------------------------------------
--  เดิมข้อมูลรถกระจายอยู่ 4 ที่ และเก็บไม่เท่ากัน:
--    fp_chassis            มีสถานที่เดิม + สถานที่ปัจจุบัน + วันขาย  (ครบสุด)
--    loan_chassis          มีสถานที่ช่องเดียว
--    promissory_notes      เก็บเป็นรายการในตัวสัญญา ไม่มีสถานที่
--    leases.chassis_no     เก็บเลขตัวถังอย่างเดียว
--
--  ผลคือรถคันเดียวกันมีสถานที่ได้หลายค่า ขึ้นกับว่าดูจากสัญญาไหน
--  ตารางนี้ทำให้ "รถ 1 คัน = 1 ระเบียน" — สถานที่และสถานะอยู่ที่เดียว
--  ส่วนตารางลูกของแต่ละโมดูลยังอยู่เหมือนเดิม (บอกว่ารถผูกกับสัญญาไหน)
-- =====================================================================

CREATE TABLE IF NOT EXISTS vehicles (
  id                UUID          NOT NULL DEFAULT uuid_generate_v4(),
  chassis_no        TEXT          NOT NULL,
  engine_no         TEXT,
  car_model         TEXT,
  brand             TEXT,
  color             TEXT,
  model_year        INT,

  -- สถานที่ — ที่เดียวของทั้งระบบ
  original_location TEXT,                     -- สถานที่ตอนรับรถเข้าครั้งแรก
  current_location  TEXT,                     -- สถานที่ปัจจุบัน (ย้ายได้)
  location_note     TEXT,
  moved_at          TIMESTAMPTZ,              -- ย้ายครั้งล่าสุดเมื่อไร

  -- วงจรชีวิตของรถ
  status            TEXT          NOT NULL DEFAULT 'Open',  -- Open / Sold / Returned / Written Off
  receive_date      DATE,                     -- วันรับรถเข้า
  sold_date         DATE,
  sold_source       TEXT,                     -- netsuite / manual
  sold_amount       NUMERIC(18,2),

  cost              NUMERIC(18,2),            -- ราคาทุน (ใช้กระจาย Curtailment รายคัน)
  subsidiary        TEXT,                     -- บริษัทย่อยที่ถือรถ

  netsuite_item_id  TEXT,                     -- อ้างอิงกลับ NetSuite Inventory
  remark            TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_vehicles PRIMARY KEY (id),
  CONSTRAINT uk_vehicles_chassis UNIQUE (chassis_no)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_status   ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_location ON vehicles(current_location);
CREATE INDEX IF NOT EXISTS idx_vehicles_sold     ON vehicles(sold_date) WHERE sold_date IS NOT NULL;

COMMENT ON TABLE vehicles IS
  'ทะเบียนรถกลาง — รถ 1 คันมี 1 ระเบียน ไม่ว่าจะผูกกับสัญญาใด · สถานที่และสถานะอยู่ที่นี่ที่เดียว';
COMMENT ON COLUMN vehicles.cost IS
  'ราคาทุนต่อคัน — ใช้กระจายยอดคืนเงินต้น (Curtailment) ของ Floor Plan ให้รายคัน';

-- ── ประวัติการย้ายรถ ──
CREATE TABLE IF NOT EXISTS vehicle_movements (
  id            UUID        NOT NULL DEFAULT uuid_generate_v4(),
  vehicle_id    UUID        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_location TEXT,
  to_location   TEXT        NOT NULL,
  moved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moved_by      TEXT,
  reason        TEXT,
  CONSTRAINT pk_vehicle_movements PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_moves ON vehicle_movements(vehicle_id, moved_at DESC);

COMMENT ON TABLE vehicle_movements IS
  'ประวัติการย้ายสถานที่ของรถแต่ละคัน — ตอบคำถามว่ารถเคยอยู่ที่ไหนบ้าง';

-- ── ย้ายข้อมูลรถที่มีอยู่เข้าทะเบียนกลาง (รันซ้ำได้) ──
-- Floor Plan มีข้อมูลครบสุด จึงเอาเป็นหลักก่อน
INSERT INTO vehicles (chassis_no, engine_no, car_model, original_location, current_location,
                      receive_date, sold_date, sold_source, cost, status)
SELECT DISTINCT ON (c.chassis_no)
  c.chassis_no, c.engine_no, c.model,
  c.original_location, COALESCE(c.current_location, c.original_location),
  c.receive_date, c.sold_date, c.sold_source, c.amount,
  CASE WHEN c.sold_date IS NOT NULL THEN 'Sold' ELSE 'Open' END
FROM fp_chassis c
WHERE COALESCE(TRIM(c.chassis_no), '') <> ''
ORDER BY c.chassis_no, c.sold_date DESC NULLS LAST
ON CONFLICT (chassis_no) DO NOTHING;

-- Loan — เติมคันที่ยังไม่มี
INSERT INTO vehicles (chassis_no, engine_no, car_model, current_location, cost, status)
SELECT DISTINCT ON (c.chassis_no)
  c.chassis_no, c.engine_no, c.car_model, c.location, c.cost, 'Open'
FROM loan_chassis c
WHERE COALESCE(TRIM(c.chassis_no), '') <> ''
ORDER BY c.chassis_no
ON CONFLICT (chassis_no) DO NOTHING;

-- P/N — เก็บเป็นรายการในตัวสัญญา
INSERT INTO vehicles (chassis_no, car_model, status)
SELECT DISTINCT ON (x->>'chassis_no')
  x->>'chassis_no',
  COALESCE(x->>'model', x->>'car_model'),
  'Open'
FROM promissory_notes p, jsonb_array_elements(COALESCE(p.chassis_list, '[]'::jsonb)) x
WHERE COALESCE(TRIM(x->>'chassis_no'), '') <> ''
ORDER BY x->>'chassis_no'
ON CONFLICT (chassis_no) DO NOTHING;

-- สัญญาเช่า (HP)
INSERT INTO vehicles (chassis_no, car_model, status)
SELECT DISTINCT ON (l.chassis_no) l.chassis_no, l.asset_name, 'Open'
FROM leases l
WHERE COALESCE(TRIM(l.chassis_no), '') <> ''
ORDER BY l.chassis_no
ON CONFLICT (chassis_no) DO NOTHING;

-- ── RLS ──
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_vehicles" ON vehicles;
CREATE POLICY "anon_all_vehicles" ON vehicles FOR ALL USING (TRUE) WITH CHECK (TRUE);

ALTER TABLE vehicle_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_vehicle_movements" ON vehicle_movements;
CREATE POLICY "anon_all_vehicle_movements" ON vehicle_movements FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── อัปเดต updated_at + บันทึกประวัติเมื่อย้ายสถานที่ ──
CREATE OR REPLACE FUNCTION touch_vehicles()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.current_location IS DISTINCT FROM OLD.current_location THEN
    NEW.moved_at = NOW();
    INSERT INTO vehicle_movements (vehicle_id, from_location, to_location)
    VALUES (NEW.id, OLD.current_location, NEW.current_location);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_vehicles ON vehicles;
CREATE TRIGGER trg_touch_vehicles
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION touch_vehicles();
