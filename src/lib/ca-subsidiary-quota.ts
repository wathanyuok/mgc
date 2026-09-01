// โควตาวงเงินของบริษัทย่อยใต้สัญญาหลัก
//
// โครงวงเงินเป็น 3 ชั้น — สัญญาหลัก (ระดับธนาคาร) → วงเงินย่อย → ธุรกรรม
// สัญญาหลักแตกวงเงินให้บริษัทย่อยเป็นตารางจัดสรร วงเงินย่อยจึงต้องระบุว่า
// เบิกจากโควตาของบริษัทไหน
//
// บริษัทย่อยบน "หัว" สัญญาหลัก กับบริษัทย่อยใน "ตารางจัดสรร" คนละความหมาย
//   หัวสัญญา    = บริษัทที่เซ็นสัญญากับธนาคาร เป็นเจ้าของเอกสาร
//   ตารางจัดสรร = บริษัทที่ได้รับวงเงินไปเบิกใช้จริง
// วงเงินย่อยต้องเลือกจากตารางจัดสรร ไม่ใช่จากหัวสัญญา
//
// แยกออกมาจากหน้าจอเพื่อให้ทดสอบได้ และให้มีที่แก้ที่เดียวถ้ากติกาเปลี่ยน

export interface SubsidiaryAllocation {
  subsidiary: string;
  credit_line: number;
  utilization: number;
}

export interface SubsidiaryOptionsInput {
  /** ยังไม่ได้เลือกสัญญาหลัก */
  maId: string | null | undefined;
  /** ตารางจัดสรรของสัญญาหลักใบนั้น */
  allocated: SubsidiaryAllocation[];
  /** บริษัทบนหัวสัญญาหลัก — ใช้เมื่อยังไม่ได้จัดสรร */
  maMain: string;
  /** ค่าที่บันทึกไว้เดิมของวงเงินย่อยใบนี้ */
  current: string;
  /** บริษัททั้งหมดในข้อมูลหลัก */
  allCodes: string[];
}

/**
 * บริษัทที่วงเงินย่อยใบนี้เลือกได้
 *
 * - ยังไม่เลือกสัญญาหลัก → เลือกได้ทุกบริษัท (ยังไม่มีอะไรมาจำกัด)
 * - สัญญาหลักจัดสรรแล้ว   → เฉพาะบริษัทในตารางจัดสรร
 * - สัญญาหลักยังไม่จัดสรร → บริษัทบนหัวสัญญาเป็นตัวเลือกเดียว
 *   (บางสัญญาไม่ได้แตกบริษัท เซ็นเองใช้เอง)
 * - สัญญาเก่าที่บันทึกบริษัทซึ่งตอนนี้ไม่มีโควตาแล้ว ต้องยังเห็นค่าเดิมของตัวเอง
 *   ไม่งั้นเปิดหน้าขึ้นมาช่องจะว่าง แล้วบันทึกทับข้อมูลเดิมโดยไม่ตั้งใจ
 */
export function subsidiaryOptions(inp: SubsidiaryOptionsInput): string[] {
  if (!inp.maId) return inp.allCodes;

  const base = inp.allocated.length > 0
    ? inp.allocated.map((a) => a.subsidiary).filter(Boolean)
    : (inp.maMain ? [inp.maMain] : []);

  return inp.current && !base.includes(inp.current) ? [...base, inp.current] : base;
}

export interface Quota {
  /** โควตาที่สัญญาหลักจัดสรรให้บริษัทนี้ */
  allocated: number;
  /** วงเงินย่อยใบอื่นของบริษัทนี้ใช้ไปแล้วเท่าไร */
  usedByOthers: number;
  /** เปิดได้อีกเท่าไร */
  free: number;
}

/**
 * โควตาคงเหลือของบริษัทที่เลือก
 *
 * ยอดที่ใช้ไปแล้วในตารางจัดสรรรวมวงเงินย่อยใบที่กำลังแก้อยู่ด้วย
 * ต้องหักตัวเองออกก่อน ไม่งั้นแก้วงเงินใบเดิมโดยไม่เปลี่ยนตัวเลขก็จะฟ้องว่าเกินโควตา
 *
 * คืน null เมื่อบริษัทนี้ไม่มีแถวในตารางจัดสรร — แปลว่าไม่มีโควตาให้เทียบ
 */
export function subsidiaryQuota(
  allocated: SubsidiaryAllocation[],
  subsidiary: string,
  ownCreditLine = 0,
): Quota | null {
  const row = allocated.find((a) => a.subsidiary === subsidiary);
  if (!row) return null;

  const allocatedAmt = Number(row.credit_line ?? 0);
  const usedByOthers = Math.max(Number(row.utilization ?? 0) - Number(ownCreditLine ?? 0), 0);
  return { allocated: allocatedAmt, usedByOthers, free: allocatedAmt - usedByOthers };
}

/** วงเงินใบนี้เกินโควตาที่บริษัทนั้นเหลืออยู่หรือไม่ — เผื่อเศษสตางค์จากการปัดเลข */
export function isOverQuota(quota: Quota | null, creditLine: number): boolean {
  return !!quota && creditLine > quota.free + 0.01;
}
