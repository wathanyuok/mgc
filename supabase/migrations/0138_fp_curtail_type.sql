-- Floor Plan — เลือก "ประเภทรถ (Curtailment Type)" (MoM 30 ก.ย. บ.1635-1639)
--   ผู้จำหน่ายรายเดียวมีตารางลดต้นหลายชุด (New / Used / ...) → FP เลือก type เพื่อผูกชุดที่ถูก
--   ว่าง = ใช้ชุดที่เริ่มใช้ล่าสุด (พฤติกรรมเดิม)
alter table floor_plans
  add column if not exists curtail_type text;
