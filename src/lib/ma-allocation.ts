// ตารางจัดสรรวงเงินในสัญญาหลัก — กติกาการเอาบริษัทออก
//
// แถวจัดสรรคือฐานของโควตา ถ้าเอาบริษัทออกทั้งที่บริษัทนั้นมีวงเงินย่อยใช้อยู่
// วงเงินย่อยจะลอย ไม่มีโควตารองรับ แล้วการตรวจ "เกินโควตาไหม" ของใบถัดไป
// จะคำนวณจากฐานที่ไม่มีอยู่จริง
//
// ใช้กติกาเดียวกับตอนลบสัญญาหลักทั้งใบ ซึ่งระบบห้ามอยู่แล้วเมื่อยังมีวงเงินย่อยผูกอยู่

/** วงเงินย่อยที่ยังมีชีวิต — ยังใช้โควตาของบริษัทนั้นอยู่ */
const LIVE_CA_STATUSES = ['Draft', 'Pending Approval', 'Approved'] as const;

/**
 * สถานะที่แปลว่าวงเงินย่อยจบแล้ว ไม่กินโควตาอีก
 *
 * Rejected = ถูกปฏิเสธตั้งแต่ต้น · Expired / Closed / Terminated = ปิดไปแล้ว
 * ทั้งหมดนี้เอาบริษัทออกได้ เพราะไม่มีภาระค้างอยู่กับโควตาแล้ว
 */
export function isLiveCaStatus(status: string | null | undefined): boolean {
  return (LIVE_CA_STATUSES as readonly string[]).includes(String(status ?? ''));
}

export interface CaLike {
  ca_name?: string | null;
  contract_number?: string | null;
  subsidiary?: string | null;
  status?: string | null;
}

/**
 * วงเงินย่อยที่ขวางการเอาบริษัทนี้ออกจากตารางจัดสรร
 *
 * คืนรายการเปล่า = เอาออกได้
 */
export function casBlockingRemoval(cas: CaLike[], subsidiary: string | null | undefined): CaLike[] {
  if (!subsidiary) return [];
  return cas.filter((c) => c.subsidiary === subsidiary && isLiveCaStatus(c.status));
}

/**
 * ข้อความบอกว่าทำไมเอาออกไม่ได้ — คืน null เมื่อเอาออกได้
 *
 * ต้องบอกเลขที่วงเงินด้วย ไม่งั้นผู้ใช้ต้องไปไล่หาเองว่าใบไหนขวางอยู่
 */
export function removalBlockedReason(
  cas: CaLike[],
  subsidiary: string | null | undefined,
): string | null {
  const blocking = casBlockingRemoval(cas, subsidiary);
  if (blocking.length === 0) return null;

  const names = blocking
    .slice(0, 3)
    .map((c) => c.contract_number || c.ca_name || '(ไม่มีเลขที่)')
    .join(' · ');
  const more = blocking.length > 3 ? ` และอีก ${blocking.length - 3} ใบ` : '';

  return (
    `เอา ${subsidiary} ออกไม่ได้ — ยังมีวงเงินย่อย ${blocking.length} ใบที่ใช้โควตาของบริษัทนี้อยู่\n` +
    `${names}${more}\n` +
    'ถ้าต้องการเอาออก ให้ปิดวงเงินย่อยเหล่านั้นก่อน'
  );
}
