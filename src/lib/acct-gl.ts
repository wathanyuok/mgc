// =====================================================================
// อ่านรหัสบัญชีจากแท็บ Accounting (acct_cards) ตามบทบาทบัญชี
//
// ใช้ร่วมกันทุกโมดูล เพื่อให้ "การเลือกบัญชีในหน้าจอมีผลกับใบสำคัญจริง"
// รูปแบบเดียวกับ glFor ของ T/R — map รหัส → บทบาท โดยทิศทาง Dr/Cr ยังตายตัวในโค้ด
//
//   acct_cards แต่ละรายการ = { type, gl } โดย gl = "รหัส<เว้นวรรค>ชื่อ"
//   ตัดคำแรกก่อนช่องว่างเป็น code ที่เหลือเป็น name
//   ถ้ายังไม่ผูกบทบาทนั้น → ใช้ fallback (ค่าตั้งต้นเดิมในโค้ด)
// =====================================================================

export interface AcctCardLike {
  type?: string;
  gl?: string | null;
}

export interface GLRef {
  code: string;
  name: string;
}

/** แยก "รหัส ชื่อ" ออกเป็น { code, name } */
export function splitGL(raw: string): GLRef {
  const sp = raw.indexOf(' ');
  return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
}

/**
 * หยิบบัญชีตามบทบาทจาก acct_cards — ไม่พบให้ใช้ fallback
 * @param cards    acct_cards ของสัญญา
 * @param acctType ชื่อบทบาท เช่น 'INVENTORY FLOOR PLAN ACCOUNT'
 * @param fallback ค่าตั้งต้น "รหัส ชื่อ" ใช้เมื่อยังไม่ผูก
 */
export function glFrom(
  cards: AcctCardLike[] | null | undefined,
  acctType: string,
  fallback: string,
): GLRef {
  const card = (cards ?? []).find((a) => a.type === acctType);
  return splitGL(card?.gl ?? fallback);
}
