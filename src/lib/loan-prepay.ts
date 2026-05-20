// =====================================================================
//  Loan prepayment helpers — outstanding, accrued interest, fee tiers
//  Mirrors master_agreement_v30.html Full/Partial Prepayment modals:
//    • Prepayment Fee Rate Card (tiered by months since contract start)
//    • FEE BASE = Outstanding Principal | Prepayment Amount
//    • Full   = Outstanding + Accrued Interest + Fee → close
//    • Partial = Amount + Fee, then re-amortize remaining schedule
// =====================================================================

import type { LoanScheduleRow } from './loan-schedule';

export interface PrepayTier {
  label: string;
  withinMonths: number | null; // null = "after the last tier"
  rate: number;                // % fee
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
  outstanding: number;        // principal still owed as of the date
  principalPaid: number;      // principal repaid to date
  accruedInterest: number;    // interest accrued since the last paid period end
  lastPaidPeriod: number;     // 0 if none paid yet
  remainingPeriods: number;   // scheduled periods still ahead
  currentInstallment: number; // representative installment going forward
  lastEndDate: string | null; // end date of the last paid period
}

/**
 * Compute outstanding principal + accrued interest as of `asOfISO`,
 * walking the (original) amortization schedule.
 */
export function computeOutstanding(
  schedule: LoanScheduleRow[],
  asOfISO: string,
  annualRate: number,
  installmentStart: string,
  principal: number,
): OutstandingResult {
  if (!schedule.length) {
    return {
      outstanding: principal, principalPaid: 0, accruedInterest: 0,
      lastPaidPeriod: 0, remainingPeriods: 0, currentInstallment: 0, lastEndDate: null,
    };
  }
  // Last period whose end date is on/before the prepayment date = "paid".
  const paid = schedule.filter((r) => r.endDate <= asOfISO);
  const last = paid.length ? paid[paid.length - 1] : null;
  const outstanding = last ? last.endBalance : principal;
  const principalPaid = principal - outstanding;
  const lastEndDate = last ? last.endDate : installmentStart;

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
    lastPaidPeriod: last ? last.period : 0,
    remainingPeriods: ahead.length,
    currentInstallment,
    lastEndDate,
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
