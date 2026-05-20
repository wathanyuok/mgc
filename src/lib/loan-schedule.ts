// =====================================================================
//  Loan amortization schedule — MoM / HTML-faithful (master_agreement_v30)
//  Handles all Schedule Information fields:
//    - PAYMENT TYPE        → Fix Installment | Fix Principal | Grace
//    - RESIDUAL VALUE (RV) → balloon as PMT future value (FV)
//    - BALLOON OPTION      → placement: with-last | after-term (N+1) | before-term (N-1)
//    - INCLUDE RV IN INSTALLMENT → if false, RV is split out as a separate balloon period
//    - PAY AT END OF MONTH → period boundary dates snap to month-end
//  Interest accrues by actual day-count (actual/365) per MoM (BRG: "คำนวณดอกเบี้ย
//  รายวัน"), using the effective rate card in force on the period start date
//  (multi-rate Fix+Float). Each period's interest = balance × rate × days / 365.
// =====================================================================

import { pmt } from './lease-calc';
import { pickEffectiveRate } from './rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

export type BalloonPlacement = 'with-last' | 'after-term' | 'before-term';
export type ReamortizeMode = 'reduce-installment' | 'reduce-term';

export interface PrepaymentEvent {
  date: string;          // ISO yyyy-mm-dd — when the lump sum is paid
  amount: number;        // principal prepaid (extra, on top of the period installment)
  mode: ReamortizeMode;  // reduce-installment (same term) | reduce-term (same installment)
}

export interface LoanScheduleInput {
  principal: number;
  rateCards: RateCard[];          // multi-rate (Fix + Float)
  fallbackRate: number;           // used when no rate cards present (annual %)
  termMonths: number;
  installmentStart: string;       // ISO yyyy-mm-dd
  paymentType: string;            // raw select value
  residualValue?: number;         // balloon / RV
  balloonOption?: string | null;  // raw select value
  includeRvInInstallment?: boolean;
  payEom?: boolean;               // pay at end of month
  gracePeriods?: number;          // interest-only months at start (default 0)
  prepayments?: PrepaymentEvent[]; // partial prepayments folded into the schedule
  stepMonths?: number;            // months per period: 1 = monthly, 3 = quarterly, 12 = yearly
}

export interface LoanScheduleRow {
  period: number;
  startDate: string;
  endDate: string;
  days: number;
  installment: number;            // total cash paid this period (incl. balloon)
  principal: number;
  interest: number;
  beginBalance: number;
  endBalance: number;
  isBalloon: boolean;
  note?: string;
}

export interface LoanScheduleResult {
  rows: LoanScheduleRow[];
  representativeInstallment: number;  // the level installment (first amortizing period)
  totalPayment: number;
  totalInterest: number;
  totalPrincipal: number;
}

// ── classify payment type from the raw select string ──
function classify(paymentType: string) {
  const p = (paymentType || '').toLowerCase();
  return {
    fixPrincipal: p.includes('fix principal'),
    grace: p.includes('grace'),
    balloon: p.includes('balloon'), // balloon applies only for the "(Balloon)" payment types
  };
}

// ── resolve balloon placement from option + include-in-installment flag ──
function resolvePlacement(
  hasBalloon: boolean,
  opt: string | null | undefined,
  includeRv: boolean,
): BalloonPlacement | null {
  if (!hasBalloon) return null;
  // Unchecking "include RV in installment" forces the balloon into its own period.
  if (!includeRv) return 'after-term';
  if (opt && opt.includes('หลัง')) return 'after-term'; // หลัง Term → งวด N+1
  if (opt && opt.includes('ก่อน')) return 'before-term'; // ก่อน Term → ลดงวดเหลือ N-1
  return 'with-last'; // พร้อมค่างวด (รวมในงวดสุดท้าย)
}

// ── period boundary date; snaps to month-end when payEom ──
// Computed from month arithmetic (not setMonth) so short months are handled per
// MoM: Feb end = 28/29 (not 30/31); a fixed pay-day of 30/31 clamps to the last
// valid day of the target month instead of overflowing into the next month.
function periodDate(base: Date, k: number, payEom: boolean): Date {
  const monthIndex = base.getMonth() + k;
  const targetYear = base.getFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate(); // days in target month
  if (payEom) return new Date(targetYear, targetMonth, lastDay);
  return new Date(targetYear, targetMonth, Math.min(base.getDate(), lastDay));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

function rateOn(input: LoanScheduleInput, dateStr: string): number {
  if (input.rateCards && input.rateCards.length > 0) {
    const { rate } = pickEffectiveRate(input.rateCards, dateStr);
    if (rate > 0) return rate;
  }
  return input.fallbackRate || 0;
}

export function buildLoanSchedule(input: LoanScheduleInput): LoanScheduleResult {
  const empty: LoanScheduleResult = {
    rows: [], representativeInstallment: 0, totalPayment: 0, totalInterest: 0, totalPrincipal: 0,
  };
  if (!input.principal || !input.termMonths || !input.installmentStart) return empty;

  const cls = classify(input.paymentType);
  const { fixPrincipal } = cls;
  // Balloon ทำงานเฉพาะเมื่อเลือก Payment Type ที่มี "(Balloon)" (ตาม dropdown) + มียอด balloon
  const balloon = cls.balloon ? Math.max(0, input.residualValue ?? 0) : 0;
  const hasBalloon = balloon > 0;
  const placement = resolvePlacement(hasBalloon, input.balloonOption, input.includeRvInInstallment ?? true);
  const payEom = !!input.payEom;
  const grace = Math.max(0, Math.floor(input.gracePeriods ?? 0));
  const step = Math.max(1, Math.round(input.stepMonths ?? 1)); // months per period (1/3/12)
  const totalPeriods = Math.max(1, Math.round(input.termMonths / step));

  // Number of amortizing periods (the balloon bullet, if any, is appended after).
  const amortTerm = placement === 'before-term'
    ? Math.max(1, totalPeriods - 1)
    : totalPeriods;
  const balloonInLast = placement === 'with-last' || placement === 'before-term';
  const balloonSeparate = placement === 'after-term';

  // FV used inside the amortizing periods: when the balloon rides the last
  // amortizing period it is part of the closing principal; when it is a separate
  // period the amortizing periods must leave exactly `balloon` outstanding.
  const fvForAmort = hasBalloon ? balloon : 0;

  // Level installment from the origination rate (rate fixed at signing per MoM).
  const origRate = rateOn(input, input.installmentStart);
  const payingPeriods = Math.max(1, amortTerm - grace);
  // Mutable so a prepayment with mode "reduce-installment" can re-amortize the rest.
  let level = fixPrincipal
    ? 0 // computed per-period below
    : pmt(input.principal, origRate * step, payingPeriods, fvForAmort);
  let fixedPrincipalPortion = fixPrincipal
    ? (input.principal - fvForAmort) / payingPeriods
    : 0;

  const target = balloonSeparate ? balloon : 0;
  const base = new Date(input.installmentStart);
  const rows: LoanScheduleRow[] = [];
  let balance = input.principal;
  let closedEarly = false;

  for (let i = 1; i <= amortTerm; i++) {
    const start = periodDate(base, (i - 1) * step, payEom);
    const end = periodDate(base, i * step, payEom);
    const days = Math.max(0, dayDiff(start, end));
    const rate = rateOn(input, iso(start));
    const interest = (balance * rate * days) / 100 / 365; // daily accrual (actual/365) — MoM: คิดดอกเบี้ยรายวัน
    const beginBalance = balance;

    // Lump-sum prepayment(s) landing within this period (start < date ≤ end).
    const pp = (input.prepayments ?? []).filter(
      (p) => p.amount > 0 && p.date > iso(start) && p.date <= iso(end),
    );
    const extra = pp.reduce((s, p) => s + p.amount, 0);
    const mode: ReamortizeMode = pp.length ? pp[pp.length - 1].mode : 'reduce-installment';

    // Normal (scheduled) portion for this period.
    let normalInstallment: number;
    let note: string | undefined;
    if (i <= grace) {
      normalInstallment = interest; // interest-only grace
      note = 'Grace';
    } else if (fixPrincipal) {
      normalInstallment = fixedPrincipalPortion + interest;
    } else {
      normalInstallment = level;
    }
    const normalPrincipal = normalInstallment - interest;

    // Does the contract close on this period? (natural end, or balance cleared early)
    const tentativeEnd = beginBalance - normalPrincipal - extra;
    const isFinal = i === amortTerm || tentativeEnd <= target + 0.005;

    let principalPaid: number;
    let installment: number;
    if (isFinal) {
      principalPaid = beginBalance - target;     // clears down to balloon target (incl. any extra)
      installment = principalPaid + interest;
      if (extra > 0) note = (note ? note + ' + ' : '') + 'Prepay';
      if (balloonInLast && hasBalloon) note = (note ? note + ' + ' : '') + 'Balloon';
      balance = target;
      closedEarly = true;
    } else {
      principalPaid = normalPrincipal + extra;
      installment = normalInstallment + extra;
      if (extra > 0) note = (note ? note + ' + ' : '') + 'Prepay';
      balance = beginBalance - principalPaid;
      // Re-amortize the remaining periods after a prepayment.
      if (extra > 0) {
        const remaining = amortTerm - i;
        if (remaining > 0 && mode === 'reduce-installment') {
          if (fixPrincipal) fixedPrincipalPortion = (balance - target) / remaining;
          else level = pmt(balance, origRate * step, remaining, target);
        }
        // reduce-term: keep installment, balance depletes faster → closes early above.
      }
    }

    rows.push({
      period: i,
      startDate: iso(start),
      endDate: iso(end),
      days,
      installment,
      principal: principalPaid,
      interest,
      beginBalance,
      endBalance: balance,
      isBalloon: isFinal && balloonInLast && hasBalloon,
      note,
    });

    if (closedEarly) break;
  }

  // Separate balloon bullet — period N+1 (placement = after-term).
  if (balloonSeparate && hasBalloon && balance > 0.005) {
    const last = rows[rows.length - 1];
    const startISO = last ? last.endDate : input.installmentStart;
    const start = new Date(startISO);
    const end = periodDate(start, step, payEom);
    const days = Math.max(0, dayDiff(start, end));
    // MoM (Day4 §5.1 + HP txt บรรทัด 654): "งวดที่จ่ายบอลลูนจะไม่มีดอกเบี้ย ... ถือเป็น Grace"
    const interest = 0;
    const beginBalance = balance;
    const principalPaid = balance;
    rows.push({
      period: (last?.period ?? amortTerm) + 1,
      startDate: startISO,
      endDate: iso(end),
      days,
      installment: principalPaid + interest,
      principal: principalPaid,
      interest,
      beginBalance,
      endBalance: 0,
      isBalloon: true,
      note: 'Balloon (ไม่คิดดอกเบี้ย)',
    });
    balance = 0;
  }

  const totalPayment = rows.reduce((s, r) => s + r.installment, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0);
  const totalPrincipal = rows.reduce((s, r) => s + r.principal, 0);
  const firstAmort = rows.find((r) => !r.isBalloon && r.note !== 'Grace');

  return {
    rows,
    representativeInstallment: firstAmort ? firstAmort.installment : (rows[0]?.installment ?? 0),
    totalPayment,
    totalInterest,
    totalPrincipal,
  };
}
