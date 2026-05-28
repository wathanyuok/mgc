// Floor Plan schedule calculation — Curtailment milestones from Curtailment master
// Default, 180 (10%), 270 (80%) from drawdown.
// Interest = Outstanding Principal × Rate / 365 × Days in period.
// Multi-rate: when rate_cards passed, each period uses rate based on its start date

import { pickEffectiveRate } from './rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

export interface CurtailmentMilestone {
  day: number;
  pct: number;
}

export interface FPSchedulePeriod {
  period: number;
  startDate: string;
  endDate: string;
  days: number;
  rate: number;
  curtailPct: number; // 0, 10, 80 (BMW) | 0 (Other)
  curtailAmount: number; // baht amount for this period
  interest: number; // interest accrued
  principalBalance: number; // outstanding after this period's curtailment
  interestBalance: number; // remaining interest yet to recognize
}

/** End-of-month for a given date */
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Days between two dates — EXCLUSIVE (b − a, calendar days).
 *  Matches bank actual practice (Loan Calc Table: Jan 1 → Jan 31 = 30 days). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Local-timezone-safe ISO (YYYY-MM-DD) — avoids the off-by-one shift caused
// by Date.toISOString() converting to UTC.
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Normalize to local-midnight to avoid timezone-of-day mismatch between
// addDays(start, N) and endOfMonth() boundaries (both should compare as YYYY-MM-DD).
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * Default Curtailment milestones — fallback when no master record matches.
 * Per.
 */
export const DEFAULT_CURTAILMENT: CurtailmentMilestone[] = [
  { day: 90, pct: 10 },
  { day: 180, pct: 10 },
  { day: 270, pct: 80 },
];

/**
 * Convert curtailment master row (tier1..6) → milestones array.
 * Supports up to 6 tiers (BMW Used = 6 milestones). Returns DEFAULT if all null.
 */
export function curtailmentFromMaster(c: any | null | undefined): CurtailmentMilestone[] {
  if (!c) return DEFAULT_CURTAILMENT;
  const list: CurtailmentMilestone[] = [];
  for (let t = 1; t <= 6; t++) {
    const d = c[`tier${t}_days`];
    const p = c[`tier${t}_pct`];
    if (d != null && p != null) list.push({ day: d, pct: p });
  }
  list.sort((a, b) => a.day - b.day); // chronological regardless of input order
  return list.length > 0 ? list : DEFAULT_CURTAILMENT;
}

/**
 * Build FP schedule periods.
 * Period 0: tx_date → tx_date — info row
 * With curtailment: month-end + curtailment date as period boundaries
 * Without: month-end only
 *
 * @param milestones Custom curtailment milestones (typically from Curtailment master)
 * Pass [] or undefined for no curtailment mode
 */
export function buildFPSchedule(
  principal: number,
  rateOrCards: number | RateCard[],
  txDate: string,
  maturity: string,
  mode: 'bmw' | 'other',
  milestones?: CurtailmentMilestone[],
): FPSchedulePeriod[] {
  if (!principal || !txDate || !maturity) return [];
  const cards = Array.isArray(rateOrCards) ? rateOrCards : null;
  const singleRate = typeof rateOrCards === 'number' ? rateOrCards : 0;
  if (!cards?.length && !singleRate) return [];

  // Normalize start & end to local-midnight so they compare consistently with
  // addDays() and endOfMonth() outputs (all local-midnight aligned).
  const startRaw = new Date(txDate);
  const start = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate());
  const endRaw = new Date(maturity);
  const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate());
  if (end <= start) return [];

  // Helper: get rate effective on a given date (ISO string)
  const rateFor = (dateStr: string): number => {
    if (cards) return pickEffectiveRate(cards, dateStr).rate;
    return singleRate;
  };

  const totalDays = daysBetween(start, end);
  // Approx total interest using start-date rate (used for Period 0 display)
  const startRate = rateFor(toISO(start));
  const totalInterestApprox = (principal * startRate * totalDays) / 100 / 365;

  // Pre-compute curtailment dates (only when in 'bmw'/with-curtailment mode)
  const effectiveMilestones =
    mode === 'bmw' ? (milestones && milestones.length > 0 ? milestones : DEFAULT_CURTAILMENT) : [];
  const curtailDates = effectiveMilestones.map((m) => ({
    date: addDays(start, m.day),
    pct: m.pct,
  }));

  // Build list of period-boundary dates (sorted, unique, between start and end)
  const boundaries: Date[] = [];
  let cur = new Date(start);
  while (cur < end) {
    const next = endOfMonth(cur);
    const stop = next > end ? end : next;
    boundaries.push(new Date(stop));
    cur = addDays(stop, 1);
  }
  // Inject curtailment dates as additional boundaries (BMW only)
  for (const c of curtailDates) {
    if (c.date > start && c.date <= end) {
      const exists = boundaries.some((b) => b.getTime() === c.date.getTime());
      if (!exists) boundaries.push(new Date(c.date));
    }
  }
  // Sort + dedupe
  boundaries.sort((a, b) => a.getTime() - b.getTime());

  // Period 0
  const periods: FPSchedulePeriod[] = [
    {
      period: 0,
      startDate: txDate,
      endDate: txDate,
      days: 0,
      rate: startRate,
      curtailPct: 0,
      curtailAmount: 0,
      interest: 0,
      principalBalance: principal,
      interestBalance: parseFloat(totalInterestApprox.toFixed(2)),
    },
  ];

  let outstandingPrincipal = principal;
  let interestRemaining = totalInterestApprox;
  let periodStart = new Date(start);
  let periodNo = 1;

  for (const boundary of boundaries) {
    // Allow boundary === periodStart (e.g. milestone day exactly on period start)
    // so that a 0-day curtailment row is created. Only skip strictly-before boundaries.
    if (boundary < periodStart) continue;
    const days = daysBetween(periodStart, boundary);
    const periodRate = rateFor(toISO(periodStart));
    const interest = (outstandingPrincipal * periodRate * days) / 100 / 365;
    interestRemaining -= interest;
    if (interestRemaining < 0.005) interestRemaining = 0;

    // Check if this boundary is a curtailment date
    const curtailHit = curtailDates.find(
      (c) => c.date.getTime() === boundary.getTime(),
    );
    const curtailPct = curtailHit?.pct ?? 0;
    const curtailAmount = curtailPct > 0 ? (principal * curtailPct) / 100 : 0;
    if (curtailAmount > 0) outstandingPrincipal -= curtailAmount;
    if (outstandingPrincipal < 0.005) outstandingPrincipal = 0;

    periods.push({
      period: periodNo++,
      startDate: toISO(periodStart),
      endDate: toISO(boundary),
      days,
      rate: periodRate,
      curtailPct,
      curtailAmount: parseFloat(curtailAmount.toFixed(2)),
      interest: parseFloat(interest.toFixed(2)),
      principalBalance: parseFloat(outstandingPrincipal.toFixed(2)),
      interestBalance: parseFloat(interestRemaining.toFixed(2)),
    });

    periodStart = addDays(boundary, 1);
    if (periodStart > end) break;
  }

  return periods;
}

export function fpTotalInterest(periods: FPSchedulePeriod[]): number {
  return periods.slice(1).reduce((s, r) => s + r.interest, 0);
}

export function fpTotalCurtailment(periods: FPSchedulePeriod[]): number {
  return periods.slice(1).reduce((s, r) => s + r.curtailAmount, 0);
}
