// =====================================================================
// Loan prepayment helpers — outstanding, accrued interest, fee tiers
// Mirrors Full/Partial Prepayment modals:
// • Prepayment Fee Rate Card (tiered by months since contract start)
// • FEE BASE = Outstanding Principal | Prepayment Amount
// • Full = Outstanding + Accrued Interest + Fee → close
// • Partial = Amount + Fee, then re-amortize remaining schedule
// =====================================================================

import type { LoanScheduleRow } from './loan-schedule';

export interface PrepayTier {
  label: string;
  withinMonths: number | null; // null = "after the last tier"
  rate: number; // % fee
}

// MGC standard prepayment fee card (HTML default).
export const DEFAULT_PREPAY_TIERS: PrepayTier[] = [
  { label: 'Within 3 months', withinMonths: 3, rate: 3 },
  { label: 'Within 6 months', withinMonths: 6, rate: 2 },
  { label: 'Within 12 months', withinMonths: 12, rate: 1 },
  { label: 'After 12 months', withinMonths: null, rate: 0 },
];

export type FeeBase = 'outstanding' | 'amount';

/** Whole months elapsed between two ISO dates (floored). */
export function monthsSince(startISO: string, asOfISO: string): number {
  const a = new Date(startISO);
  const b = new Date(asOfISO);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1; // not a full month yet
  return Math.max(0, m);
}

/** Pick the fee tier in force at `monthsElapsed`. */
export function pickPrepayTier(tiers: PrepayTier[], monthsElapsed: number): PrepayTier {
  for (const t of tiers) {
    if (t.withinMonths === null) return t;
    if (monthsElapsed < t.withinMonths) return t;
  }
  return tiers[tiers.length - 1];
}

export interface OutstandingResult {
  outstanding: number; // principal still owed as of the date
  principalPaid: number; // principal repaid to date
  accruedInterest: number; // interest accrued since the last paid period end
  lastPaidPeriod: number; // 0 if none paid yet
  remainingPeriods: number; // scheduled periods still ahead
  currentInstallment: number; // representative installment going forward
  lastEndDate: string | null; // end date of the last paid period
  /** งวดที่ถึงกำหนดแล้วแต่ยังไม่ได้ชำระจริง (ค้างชำระ) */
  overduePeriods: number;
  /** ยอดเงินต้นของงวดที่ค้างชำระ — ส่วนที่ยอดปิดสัญญาเดิมหักออกไปทั้งที่ยังไม่ได้เงิน */
  overduePrincipal: number;
  /**
   * true  = คิดจากสถานะการชำระจริงของแต่ละงวด
   * false = ไม่มีข้อมูลสถานะการชำระ จึงถือตามวันที่ในตาราง (งวดที่ถึงกำหนด = จ่ายแล้ว)
   *         ยอดที่ได้จะต่ำกว่าความจริงถ้าลูกหนี้ค้างชำระ — หน้าจอต้องขึ้นคำเตือน
   */
  basedOnActualPaid: boolean;
}

/**
 * Compute outstanding principal + accrued interest as of `asOfISO`,
 * walking the (original) amortization schedule.
 *
 * `paidPeriods` = เลขงวดที่ "ชำระจริงแล้ว" (จากคอลัมน์ paid ในตารางงวด)
 * ถ้าส่งมา ระบบจะหักเฉพาะเงินต้นของงวดที่จ่ายจริง — งวดที่ถึงกำหนดแล้วแต่ยังค้าง
 * จะยังคงอยู่ในยอดคงเหลือ ทำให้ยอดปิดสัญญาไม่ต่ำกว่าความจริง
 * ถ้าไม่ส่งมา (undefined) จะถอยไปใช้วิธีเดิมคือดูวันที่อย่างเดียว
 */
export function computeOutstanding(
  schedule: LoanScheduleRow[],
  asOfISO: string,
  annualRate: number,
  installmentStart: string,
  principal: number,
  paidPeriods?: ReadonlySet<number> | null,
): OutstandingResult {
  if (!schedule.length) {
    return {
      outstanding: principal, principalPaid: 0, accruedInterest: 0,
      lastPaidPeriod: 0, remainingPeriods: 0, currentInstallment: 0, lastEndDate: null,
      overduePeriods: 0, overduePrincipal: 0, basedOnActualPaid: !!paidPeriods,
    };
  }
  // งวดที่ถึงกำหนดชำระแล้ว ณ วันที่ที่ถาม
  const due = schedule.filter((r) => r.endDate <= asOfISO);

  let outstanding: number;
  let lastEndDate: string;
  let lastPaidPeriod: number;
  let overduePeriods = 0;
  let overduePrincipal = 0;

  if (paidPeriods) {
    // หักเฉพาะเงินต้นของงวดที่ "จ่ายจริง" — งวดค้างชำระยังนับเป็นหนี้อยู่
    const settled = due.filter((r) => paidPeriods.has(r.period));
    const unsettled = due.filter((r) => !paidPeriods.has(r.period));
    overduePeriods = unsettled.length;
    overduePrincipal = unsettled.reduce((s, r) => s + r.principal, 0);
    const paidPrincipal = settled.reduce((s, r) => s + r.principal, 0);
    outstanding = Math.max(0, principal - paidPrincipal);
    const lastSettled = settled.length ? settled[settled.length - 1] : null;
    lastPaidPeriod = lastSettled ? lastSettled.period : 0;
    lastEndDate = lastSettled ? lastSettled.endDate : installmentStart;
  } else {
    // วิธีเดิม — ถือว่างวดที่ถึงกำหนดแล้ว = จ่ายแล้ว
    const last = due.length ? due[due.length - 1] : null;
    outstanding = last ? last.endBalance : principal;
    lastPaidPeriod = last ? last.period : 0;
    lastEndDate = last ? last.endDate : installmentStart;
  }

  const principalPaid = principal - outstanding;

  const days = Math.max(0, Math.round(
    (new Date(asOfISO).getTime() - new Date(lastEndDate).getTime()) / 86400000,
  ));
  const accruedInterest = (outstanding * annualRate * days) / 100 / 365;

  const ahead = schedule.filter((r) => r.endDate > asOfISO);
  const currentInstallment = ahead.length ? ahead[0].installment : 0;

  return {
    outstanding,
    principalPaid,
    accruedInterest,
    lastPaidPeriod,
    remainingPeriods: ahead.length,
    currentInstallment,
    lastEndDate,
    overduePeriods,
    overduePrincipal,
    basedOnActualPaid: !!paidPeriods,
  };
}

/** Prepayment fee = base amount × tier rate. */
export function computePrepayFee(
  feeBase: FeeBase,
  outstanding: number,
  prepayAmount: number,
  tierRate: number,
): number {
  const base = feeBase === 'amount' ? prepayAmount : outstanding;
  return (base * tierRate) / 100;
}

/** Map the FEE BASE select string → internal enum. */
export function feeBaseFromLabel(label: string | null | undefined): FeeBase {
  return (label ?? '').toLowerCase().includes('amount') ? 'amount' : 'outstanding';
}
