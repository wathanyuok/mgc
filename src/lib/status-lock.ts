/**
 * Status-based lock policy (Option B+ — agreed with PM 2026-05-29)
 *
 * Each transaction module has 3 lifecycle phases:
 *  • OPEN      — Draft/Approved/Active/Roll Over/Modified · fully editable
 *  • FROZEN    — Suspended (only OD today) · terms frozen but JE accrual still works
 *  • TERMINAL  — Closed/Cancelled/Repaid/Released/Terminated/Settled/Expired/Converted/Rejected
 *                · read-only (everything blocked except Status revert)
 *
 * Why a shared module:
 *  • Same UX banner across all 9 transaction types
 *  • Single place to tweak rules later (compliance / audit)
 *  • Save / Post-JE guards mirror each other
 */

export type ModuleKey =
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
  // Repaid = "closed by full repayment" — terms locked but JE backfill still allowed (BR-FP-008)
  OD:    { terminalStatuses: ['Closed', 'Cancelled'],            frozenStatuses: ['Suspended'], label: 'O/D' },
  FP:    { terminalStatuses: ['Closed', 'Cancelled'],            frozenStatuses: ['Repaid'],    label: 'Floor Plan' },
  PN:    { terminalStatuses: ['Closed', 'Cancelled'],            frozenStatuses: ['Repaid'],    label: 'P/N' },
  TR:    { terminalStatuses: ['Closed', 'Cancelled'],            frozenStatuses: ['Repaid'],    label: 'T/R' },
  LG:    { terminalStatuses: ['Released', 'Terminated', 'Cancelled'], frozenStatuses: [],       label: 'LG/BG' },
  Loan:  { terminalStatuses: ['Closed', 'Rejected', 'Cancelled'], frozenStatuses: [],           label: 'Loan' },
  Lease: { terminalStatuses: ['Closed'],                          frozenStatuses: [],            label: 'Lease' },
  FXF:   { terminalStatuses: ['Settled', 'Closed', 'Cancelled'], frozenStatuses: [],            label: 'FX Forward' },
  LC:    { terminalStatuses: ['Converted', 'Expired', 'Closed'], frozenStatuses: [],            label: 'L/C' },
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
