/**
 * Status-based lock policy (Option B+ — agreed with PM 2026-05-29)
 *
 * Each transaction module has 3 lifecycle phases:
 *  • OPEN      — Draft/Approved/Active/Roll Over/Modified · fully editable
 *  • FROZEN    — Suspended (only OD today) · terms frozen but JE accrual still works
 *  • TERMINAL  — Closed/Cancelled/Repaid/Terminated/Settled/Expired/Converted/Rejected
 *                · read-only (everything blocked except Status revert)
 *
 * Why a shared module:
 *  • Same UX banner across all 9 transaction types
 *  • Single place to tweak rules later (compliance / audit)
 *  • Save / Post-JE guards mirror each other
 */

export type ModuleKey =
  | 'MA'
  | 'CA'
  | 'OD'
  | 'FP'
  | 'PN'
  | 'TR'
  | 'LG'
  | 'Loan'
  | 'Lease'
  | 'FXF'
  | 'LC';

interface StatusPolicy {
  terminalStatuses: readonly string[];
  frozenStatuses: readonly string[]; // empty = no frozen state
  label: string; // module display name for banner
}

const POLICIES: Record<ModuleKey, StatusPolicy> = {
  // สัญญาหลัก/วงเงิน: Terminated/Expired(/Closed) = จบสัญญาแล้ว ต้องล็อกเหมือน TX modules
  // Approved ยังคุมด้วย approvedLock เดิม (ต้องให้ Approver กด "ขอให้แก้ไข") · Rejected เปิดไว้ให้แก้+resubmit
  MA:    { terminalStatuses: ['Terminated', 'Expired', 'Cancelled'],          frozenStatuses: [],            label: 'MA' },
  CA:    { terminalStatuses: ['Terminated', 'Expired', 'Closed', 'Cancelled'], frozenStatuses: [],           label: 'CA' },
  // Repaid = "closed by full repayment" — terms locked but JE backfill still allowed (BR-FP-008)
  OD:    { terminalStatuses: ['Closed', 'Cancelled', 'Rejected'],            frozenStatuses: ['Suspended'], label: 'O/D' },
  FP:    { terminalStatuses: ['Closed', 'Cancelled', 'Rejected'],            frozenStatuses: ['Repaid'],    label: 'Floor Plan' },
  PN:    { terminalStatuses: ['Closed', 'Cancelled', 'Rejected'],            frozenStatuses: ['Repaid'],    label: 'P/N' },
  TR:    { terminalStatuses: ['Closed', 'Cancelled', 'Rejected'],            frozenStatuses: ['Repaid'],    label: 'T/R' },
  LG:    { terminalStatuses: ['Expired', 'Terminated', 'Cancelled', 'Rejected', 'Closed'], frozenStatuses: [], label: 'LG/BG' },
  Loan:  { terminalStatuses: ['Closed', 'Rejected', 'Cancelled'], frozenStatuses: [],           label: 'Loan' },
  // สัญญาเช่า: Roll Over = ต่อสัญญาไปฉบับใหม่แล้ว · Cancelled = ถูกปฏิเสธ
  // ทั้งสองทางคือสัญญาจบแล้ว ต้องล็อกเหมือน Closed — เดิมนับแค่ Closed
  // ทำให้สัญญาที่ถูกปฏิเสธหรือต่อไปแล้วยังแก้และลงบัญชีได้ ต่างจากโมดูลอื่น
  // (Modified ยังเปิดอยู่ เพราะเป็นการปรับปรุงมูลค่าในสัญญาฉบับเดิม ไม่ได้ออกฉบับใหม่)
  Lease: { terminalStatuses: ['Closed', 'Cancelled', 'Rejected', 'Roll Over'], frozenStatuses: [],           label: 'Lease' },
  FXF:   { terminalStatuses: ['Settled', 'Closed', 'Cancelled', 'Rejected'], frozenStatuses: [],            label: 'FX Forward' },
  // Cancelled = ถูกปฏิเสธการอนุมัติ — โมดูลอื่นนับเป็นสถานะที่จบแล้วหมด
  // L/C เป็นตัวเดียวที่ตกหล่น ทำให้รายการที่ถูกปฏิเสธยังแก้ บันทึก และลงบัญชีได้ตามปกติ
  LC:    { terminalStatuses: ['Converted', 'Expired', 'Closed', 'Cancelled', 'Rejected'], frozenStatuses: [], label: 'L/C' },
};

export interface StatusLock {
  isTerminal: boolean;
  isFrozen: boolean;
  termsFrozen: boolean; // lock structural fields (AMOUNT, rates, dates, refs)
  canEditFields: boolean; // lock all non-Status fields (Remark allowed in frozen)
  canPostJE: boolean; // lock new JE posting (allowed in frozen)
  label: string; // module display name
  bannerVariant: 'none' | 'terminal' | 'frozen';
  bannerMessage: string;
}

/**
 * ตรวจว่า "บันทึก" ได้ไหม เมื่อผู้ใช้กำลังเปลี่ยนสถานะจาก savedStatus → nextStatus
 *
 * เดิมด่านนี้เช็คจากสถานะที่เลือกอยู่บนหน้าจอ ทำให้ผู้ใช้ปิดสัญญาเองไม่ได้เลย —
 * พอเลือก Closed / Expired / Terminated ในช่องสถานะ ระบบก็ขึ้นทันทีว่า "แก้ไขไม่ได้"
 * ทั้งที่ยังไม่ได้บันทึกอะไรลงฐานข้อมูล
 *
 * กติกาที่ถูกต้อง: บล็อกเฉพาะกรณี "ปิดไปแล้ว และยังคงปิดอยู่" เท่านั้น
 *   • Active  → Closed  = ปิดสัญญา         → บันทึกได้
 *   • Closed  → Closed  = แก้ของที่ปิดแล้ว  → บันทึกไม่ได้
 *   • Closed  → Active  = เปิดกลับมาแก้     → บันทึกได้
 */
export function canSaveStatusChange(
  module: ModuleKey,
  savedStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean {
  const wasTerminal = computeStatusLock(module, savedStatus).isTerminal;
  const willBeTerminal = computeStatusLock(module, nextStatus).isTerminal;
  return !(wasTerminal && willBeTerminal);
}

export function computeStatusLock(module: ModuleKey, status: string | null | undefined): StatusLock {
  const p = POLICIES[module];
  const s = status ?? '';
  const isTerminal = p.terminalStatuses.includes(s);
  const isFrozen = p.frozenStatuses.includes(s);
  const termsFrozen = isTerminal || isFrozen;

  let bannerVariant: 'none' | 'terminal' | 'frozen' = 'none';
  let bannerMessage = '';
  if (isTerminal) {
    bannerVariant = 'terminal';
    bannerMessage = `🔒 ${p.label} นี้สถานะ ${s} แล้ว — read-only (revert Status เพื่อแก้)`;
  } else if (isFrozen) {
    bannerVariant = 'frozen';
    // Status-specific message: Suspended vs Repaid are very different situations
    if (s === 'Suspended') {
      bannerMessage = `⏸️ ระงับชั่วคราว — ธนาคารระงับการเบิกใช้ · เงื่อนไข (วงเงิน/อัตรา/วันที่) ถูก freeze · ดอกเบี้ย/JE ยังเดินปกติ`;
    } else if (s === 'Repaid') {
      bannerMessage = `✅ ชำระคืนครบแล้ว (${p.label} Repaid) — เงื่อนไขถูก freeze · ยัง Post JE ย้อนหลังของงวดที่ขาดได้ (post-close adjustment)`;
    } else {
      bannerMessage = `⏸️ ${p.label} นี้สถานะ ${s} — เงื่อนไขถูก freeze · ดอกเบี้ย/JE ยังเดินปกติ`;
    }
  }

  return {
    isTerminal,
    isFrozen,
    termsFrozen,
    canEditFields: !isTerminal,
    canPostJE: !isTerminal,
    label: p.label,
    bannerVariant,
    bannerMessage,
  };
}

/**
 * สีป้ายสถานะ (badge) ในหน้า List — มาตรฐานเดียวทุกโมดูล
 *   เขียว (success)  = มีผล/อนุมัติแล้ว   : Active, Approved
 *   ส้ม (warning)    = รอ/พักชั่วคราว     : Pending *, Suspended, Roll Over
 *   แดง (error)      = ยกเลิก/ถูกปฏิเสธ    : Cancelled, Rejected
 *   เทา (default)    = ร่าง/จบตามปกติ      : Draft, Repaid, Closed, Expired, Terminated, Settled, Converted, Modified
 */
export type BadgeColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
export function statusBadgeColor(status: string | null | undefined): BadgeColor {
  const s = status ?? '';
  if (s === 'Active' || s === 'Approved') return 'success';
  if (s === 'Cancelled' || s === 'Rejected') return 'error';
  if (s.startsWith('Pending') || s === 'Suspended' || s === 'Roll Over') return 'warning';
  return 'default'; // Draft / Repaid / Closed / Expired / Terminated / Settled / Converted / Modified
}

/**
 * ล็อกฟอร์มตามสถานะ — มาตรฐานเดียวทุกโมดูล (ให้ผลลัพธ์เดียว: read-only ไหม)
 *
 * ใช้ครอบฟอร์มด้วย <ReadOnlyContext.Provider value={isRecordEditLocked(...)}> ทุกหน้าให้เหมือนกัน
 * กฎ (ตาม Maker-Checker):
 *   • สถานะจบแล้ว (terminal) → read-only
 *   • รออนุมัติ (Pending Approval) + ไม่ใช่ผู้อนุมัติ → read-only (Maker แตะไม่ได้ระหว่างรอ)
 *   • อนุมัติแล้ว (Active / Approved) → read-only · ต้องกด "ขอให้แก้ไข" ก่อน (ยกเว้น Admin)
 *     เพื่อให้ทุกสถานะ "อนุมัติแล้ว" ผูกกับตัวเลขที่ผู้อนุมัติเห็นจริง (แก้เงียบๆ หลังอนุมัติไม่ได้)
 * viewOnly (สิทธิ์ดูอย่างเดียว) ให้ OR เพิ่มที่ฝั่งผู้เรียกเอง
 */
export function isRecordEditLocked(
  module: ModuleKey,
  savedStatus: string | null | undefined,
  isApprover: boolean,
  isAdmin: boolean,
): boolean {
  void isApprover; // เก็บพารามิเตอร์ไว้เพื่อความเข้ากันได้ (Pending ล็อกทุกคนแล้ว)
  const s = savedStatus ?? '';
  if (computeStatusLock(module, s).isTerminal) return true;              // จบแล้ว
  if (s === 'Pending Approval') return true;                            // รออนุมัติ — ล็อกทุกคน (ใช้ปุ่ม)
  if ((s === 'Active' || s === 'Approved') && !isAdmin) return true;    // อนุมัติแล้ว → ขอให้แก้ไขก่อน
  return false;
}
