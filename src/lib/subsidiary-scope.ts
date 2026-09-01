// ขอบเขตบริษัทของผู้ใช้ — ผู้ใช้คนนี้เห็นข้อมูลของบริษัทไหนได้บ้าง
//
// ที่มา — บันทึกประชุม
//   "user เห็นเฉพาะบริษัทที่สังกัด · บริษัทแม่เห็นทั้งกลุ่ม"
//   "พนักงานบัญชีอยู่สังกัดบริษัทแม่หมดเลย แต่จริงๆ เขาดูบริษัท
//    ก็คือให้เห็นเฉพาะบริษัทของตัวเองเท่านั้น ไม่เห็นทั้งหมด"
//
// เก็บที่ผู้ใช้ ไม่ใช่ที่กลุ่มสิทธิ์ — คนกลุ่มเดียวกันดูแลคนละบริษัทได้
// ถ้าเก็บที่กลุ่ม จะต้องสร้างกลุ่มแยกทุกบริษัท 16 บริษัท คูณทุกบทบาท
//
// แยกจากสิทธิ์เมนูคนละชั้น
//   สิทธิ์เมนู   ตอบว่า "ทำอะไรได้"    — ดู แก้ อนุมัติ เมนูไหน
//   ขอบเขตบริษัท ตอบว่า "เห็นของใคร"  — ไฟล์นี้

/** ผลลัพธ์ที่หน้าจอเอาไปใช้กรอง */
export interface SubsidiaryScope {
  /** ดูแลทุกบริษัท — ไม่ต้องกรองอะไรเลย */
  all: boolean;
  /** ชื่อย่อบริษัทที่ดูแล (ใช้เทียบกับช่อง subsidiary ที่เก็บเป็นชื่อย่อ) */
  codes: string[];
}

/**
 * ขอบเขตว่างเปล่า — ใช้เฉพาะตอนยังไม่ได้เข้าระบบหรือกำลังโหลดข้อมูล
 *
 * ผู้ใช้ที่เข้าระบบแล้วต้องมีบริษัทเสมอ ฐานข้อมูลบังคับไว้ (migration 0105)
 * ไม่มีสภาพ "เข้าระบบแล้วแต่ยังไม่ได้กำหนดบริษัท"
 */
export const EMPTY_SCOPE: SubsidiaryScope = { all: false, codes: [] };

/** ผู้ใช้คนนี้เห็นรายการของบริษัทนี้ไหม */
export function canSeeSubsidiary(scope: SubsidiaryScope, code: string | null | undefined): boolean {
  if (scope.all) return true;
  if (!code) return false;   // รายการที่ยังไม่ระบุบริษัท ไม่มีใครเห็นนอกจากคนดูแลทุกบริษัท
  return scope.codes.includes(code);
}

/**
 * สัญญาหลักเห็นได้ไหม
 *
 * สัญญาหลักมีบริษัทสองที่ ต้องดูทั้งคู่
 *   บริษัทคู่สัญญา  — คนเซ็นสัญญากับธนาคาร
 *   ตารางจัดสรร     — บริษัทที่ได้รับวงเงินไปใช้จริง
 *
 * ถ้าดูแค่คู่สัญญา บริษัทที่ได้รับจัดสรรจะมองไม่เห็นสัญญาที่ตัวเองได้วงเงินมา
 * ทั้งที่ต้องใช้ดูว่าเหลือเท่าไร
 */
export function canSeeMasterAgreement(
  scope: SubsidiaryScope,
  headSubsidiary: string | null | undefined,
  allocatedSubsidiaries: (string | null | undefined)[] = [],
): boolean {
  if (scope.all) return true;
  if (canSeeSubsidiary(scope, headSubsidiary)) return true;
  return allocatedSubsidiaries.some((s) => canSeeSubsidiary(scope, s));
}

/**
 * กันสร้างหรือย้ายรายการไปบริษัทที่ตัวเองไม่ได้ดูแล
 *
 * ตัวกันหน้ารายละเอียดข้ามการตรวจตอนสร้างใหม่ เพราะยังไม่มีบริษัทให้ตรวจ
 * ถ้าไม่ดักตรงนี้ ผู้ใช้จะสร้างรายการให้บริษัทอื่นได้ แล้วพอเปิดกลับมาจะเจอหน้าถูกกัน
 * กลายเป็นรายการที่สร้างเองแต่แก้ไม่ได้ และไม่มีใครรู้ว่าใครเป็นคนสร้าง
 *
 * คืนข้อความที่จะแสดง หรือ null เมื่อผ่าน
 */
export function assertCanUseSubsidiary(
  scope: SubsidiaryScope,
  code: string | null | undefined,
): string | null {
  if (scope.all) return null;
  if (!code) return null;                 // ช่องว่างมีตัวตรวจของตัวเองอยู่แล้ว
  if (scope.codes.includes(code)) return null;
  return `คุณไม่ได้ดูแลบริษัท ${code} — เลือกได้เฉพาะ ${scope.codes.join(' · ') || '(ยังไม่ได้กำหนด)'}`;
}

/**
 * กรองตัวเลือกวงเงินในหน้าธุรกรรม ให้เหลือเฉพาะวงเงินของบริษัทที่ตัวเองดูแล
 *
 * รายการธุรกรรมไม่มีช่องบริษัทของตัวเอง บริษัทมาจากวงเงินที่เลือก
 * ถ้าไม่กรองตั้งแต่ตอนเลือก ผู้ใช้จะสร้างธุรกรรมใต้วงเงินของบริษัทอื่นได้
 * แล้วเปิดกลับมาแก้ไม่ได้ เหมือนกรณีสัญญาหลักกับวงเงิน
 */
export function filterCaOptions<T extends { subsidiary?: string | null }>(
  scope: SubsidiaryScope,
  rows: T[],
): T[] {
  if (scope.all) return rows;
  return rows.filter((r) => canSeeSubsidiary(scope, r.subsidiary));
}

/**
 * เงื่อนไขสำหรับกรองในคิวรี — คืน null เมื่อไม่ต้องกรอง
 *
 * คืนเป็นรายชื่อเพื่อให้หน้าจอเอาไปต่อกับตัวกรองของตัวเองได้
 * ไม่ผูกกับรูปแบบคิวรีของฐานข้อมูลตัวใดตัวหนึ่ง
 */
export function scopeFilter(scope: SubsidiaryScope): string[] | null {
  if (scope.all) return null;
  return scope.codes;
}
