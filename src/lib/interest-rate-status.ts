// สถานะที่ "แสดงจริง" ของอัตราดอกเบี้ยแม่ (Master Interest Rate)
//
// BR/AC-MST-IR-003: อัตราใช้งานได้จริงต้อง status='Active' และยังไม่เลยวันสิ้นสุด
//   ถ้า status='Active' แต่ end_effective_date เลยวันนี้แล้ว → ถือเป็น "Expired"
//   (เก็บ DB ไว้เป็น Active เหมือนเดิม · Expired เป็นสถานะคำนวณจากวันที่ ไม่ใช่ค่าที่บันทึก
//    เพื่อให้รายการย้อนหลังที่อยู่ในช่วงมีผลยังคำนวณอัตราได้ถูกต้อง)
//
// ใช้ร่วมกันทั้งหน้า List, Detail และตัวกรอง เพื่อให้สถานะตรงกันทุกที่

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type IRStatusInput = { status: string; end_effective_date: string | null };

/** เลยวันสิ้นสุดแล้วหรือยัง (เฉพาะรายการที่ยัง Active) */
export function isIRExpired(r: IRStatusInput): boolean {
  return r.status === 'Active' && r.end_effective_date != null && r.end_effective_date < todayISO();
}

/** สถานะที่แสดงจริง: 'Expired' ถ้าเลยกำหนด · ไม่งั้นใช้สถานะที่บันทึก (Active/Inactive) */
export function effectiveIRStatus(r: IRStatusInput): string {
  return isIRExpired(r) ? 'Expired' : r.status;
}
