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
  /** วงเงินย่อยใบอื่นของบริษัทนี้กินโควตาไปแล้วเท่าไร */
  usedByOthers: number;
  /** เปิดได้อีกเท่าไร */
  free: number;
}

/** วงเงินย่อยใบหนึ่งเท่าที่ตัวตรวจโควตาต้องรู้ */
export interface CaForQuota {
  id?: string | null;
  subsidiary?: string | null;
  credit_line?: number | null;
  status?: string | null;
}

/**
 * สถานะที่แปลว่าวงเงินย่อยจบแล้ว ไม่กินโควตาอีก
 *
 * ต้องคัดออก ไม่งั้นวงเงินที่ปิดไปแล้วจะกินโควตาค้างไว้ตลอด
 * แล้วบริษัทนั้นจะเปิดวงเงินใหม่ไม่ได้เลยทั้งที่โควตาว่างอยู่จริง
 */
const CLOSED_CA_STATUSES = ['Rejected', 'Expired', 'Closed', 'Terminated'] as const;

function eatsQuota(status: string | null | undefined): boolean {
  return !(CLOSED_CA_STATUSES as readonly string[]).includes(String(status ?? ''));
}

/**
 * โควตาคงเหลือของบริษัทที่เลือก
 *
 * นับจาก "วงเงินของวงเงินย่อยใบอื่น" ไม่ใช่ "ยอดที่เบิกใช้จริง"
 *
 * เดิมอ่านช่อง utilization ของแถวจัดสรร แต่ migration 0101 เปลี่ยนความหมายช่องนั้น
 * เป็นยอดที่เบิกใช้จริงจากธุรกรรม ผลคือเปิดวงเงินย่อยรวมกันเกินโควตาได้
 * ตราบใดที่ยังไม่มีธุรกรรม — เช่นจัดสรรให้ 50,000 แต่เปิดได้สองใบ ใบละ 50,000
 *
 * ไม่ส่ง cas เข้ามา (เช่นยังโหลดไม่เสร็จ) จะถอยไปใช้ค่าเดิมในแถวจัดสรร
 * ซึ่งหลวมกว่าแต่ไม่พังจอ
 *
 * คืน null เมื่อบริษัทนี้ไม่มีแถวในตารางจัดสรร — แปลว่าไม่มีโควตาให้เทียบ
 */
export function subsidiaryQuota(
  allocated: SubsidiaryAllocation[],
  subsidiary: string,
  ownCreditLine = 0,
  cas?: CaForQuota[] | null,
  ownCaId?: string | null,
): Quota | null {
  const row = allocated.find((a) => a.subsidiary === subsidiary);
  if (!row) return null;

  const allocatedAmt = Number(row.credit_line ?? 0);

  const usedByOthers = cas
    ? cas
        .filter((c) => c.subsidiary === subsidiary && eatsQuota(c.status) && c.id !== ownCaId)
        .reduce((sum, c) => sum + Number(c.credit_line ?? 0), 0)
    // ยังไม่มีรายการวงเงินย่อยให้ดู — ใช้ค่าที่มีไปก่อน
    : Math.max(Number(row.utilization ?? 0) - Number(ownCreditLine ?? 0), 0);

  return { allocated: allocatedAmt, usedByOthers, free: allocatedAmt - usedByOthers };
}

/** วงเงินใบนี้เกินโควตาที่บริษัทนั้นเหลืออยู่หรือไม่ — เผื่อเศษสตางค์จากการปัดเลข */
export function isOverQuota(quota: Quota | null, creditLine: number): boolean {
  return !!quota && creditLine > quota.free + 0.01;
}
