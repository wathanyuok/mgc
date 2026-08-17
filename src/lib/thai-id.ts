// ตรวจเลขบัตรประชาชน / เลขทะเบียนนิติบุคคล (13 หลัก)
// ทั้งสองอย่างใช้สูตรตรวจสอบเดียวกันของกรมการปกครอง:
//   เอา 12 หลักแรกคูณน้ำหนัก 13, 12, 11, ... , 2 แล้วรวมกัน
//   หลักที่ 13 (หลักตรวจสอบ) ต้องเท่ากับ (11 − ผลรวม mod 11) mod 10
// กันคนคีย์เลขมั่ว เช่น 1111111111111 หรือพิมพ์สลับตัวเลข

/** เหลือเฉพาะตัวเลข — ตัดขีด เว้นวรรค ออก */
export const digitsOnly = (v: string) => (v ?? '').replace(/\D/g, '');

/** ใส่ขีดตามรูปแบบราชการ 1-2345-67890-12-3 (โชว์อย่างเดียว ไม่เก็บลงฐานข้อมูล) */
export function formatThaiId(v: string): string {
  const d = digitsOnly(v).slice(0, 13);
  const p = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)];
  return p.filter(Boolean).join('-');
}

/** true = เลขถูกต้องตามหลักตรวจสอบ */
export function isValidThaiId(v: string): boolean {
  const d = digitsOnly(v);
  if (d.length !== 13) return false;
  if (/^(\d)\1{12}$/.test(d)) return false; // เลขซ้ำทั้ง 13 ตัว — ผ่านสูตรได้แต่ไม่มีจริง
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return ((11 - (sum % 11)) % 10) === Number(d[12]);
}

/**
 * ข้อความบอกผู้ใช้เมื่อเลขไม่ถูกต้อง — null = ผ่าน (หรือยังกรอกไม่เสร็จ)
 * @param label คำเรียกในข้อความ เช่น "เลขบัตรประชาชน" / "เลขทะเบียนนิติบุคคล"
 */
export function thaiIdError(v: string, label = 'เลขบัตรประชาชน'): string | null {
  const d = digitsOnly(v);
  if (d.length === 0) return null;                                  // ยังไม่กรอก — ให้ required เป็นคนเตือน
  if (d.length < 13) return `${label}ต้องมี 13 หลัก (ตอนนี้ ${d.length} หลัก)`;
  if (!isValidThaiId(d)) return `${label}ไม่ถูกต้อง — ตรวจสอบตัวเลขอีกครั้ง`;
  return null;
}
