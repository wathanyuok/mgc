// Promissory Note / Trust Receipt schedule calculation
// Logic: for each period between tx_date → month-end → ... → maturity_date
// Interest = Principal × Rate% / 365 × days
// Multi-rate: when rate_cards array passed, each period uses rate based on its start date

import { pickEffectiveRate } from './rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

export interface PNSchedulePeriod {
  period: number;
  startDate: string;
  endDate: string;
  days: number;
  rate: number;
  interestPaid: number;
  principalBalance: number;
  interestBalance: number;
  dueDate: string;
}

/** End-of-month for a given date */
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Days between two dates (inclusive end) */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Build schedule periods:
 * Period 0: information row (tx → tx, total interest = sum of period interests)
 * Period 1..N: interest-accrual periods, each ending at month-end (except last = maturity)
 *
 * @param rateOrCards either single number (legacy) OR RateCard[] (multi-rate)
 */
export function buildPNSchedule(
  principal: number,
  rateOrCards: number | RateCard[],
  txDate: string,
  maturity: string,
): PNSchedulePeriod[] {
  if (!principal || !txDate || !maturity) return [];
  const cards = Array.isArray(rateOrCards) ? rateOrCards : null;
  const singleRate = typeof rateOrCards === 'number' ? rateOrCards : 0;

  // Empty cards & no single rate → nothing
  if (!cards?.length && !singleRate) return [];

  const start = new Date(txDate);
  const end = new Date(maturity);
  if (end <= start) return [];

  // Helper: get rate for a given date
  const rateFor = (dateStr: string): number => {
    if (cards) return pickEffectiveRate(cards, dateStr).rate;
    return singleRate;
  };

  // ── Pass 1: compute total interest across all periods ──
  let totalInterest = 0;
  {
    let cur = new Date(start);
    while (cur < end) {
      const next = endOfMonth(cur);
      const periodEnd = next > end ? end : next;
      const days = daysBetween(cur, periodEnd);
      const r = rateFor(cur.toISOString().slice(0, 10));
      totalInterest += (principal * r * days) / 100 / 365;
      cur = new Date(periodEnd);
      cur.setDate(cur.getDate() + 1);
      if (cur > end) break;
    }
  }

  const periods: PNSchedulePeriod[] = [
    {
      period: 0,
      startDate: txDate,
      endDate: txDate,
      days: 0,
      rate: 0,
      interestPaid: 0,
      principalBalance: principal,
      interestBalance: parseFloat(totalInterest.toFixed(2)),
      dueDate: '',
    },
  ];

  let cur = new Date(start);
  let p = 1;
  let interestRemaining = totalInterest;
  while (cur < end) {
    const next = endOfMonth(cur);
    const periodEnd = next > end ? end : next;
    const days = daysBetween(cur, periodEnd);
    const periodRate = rateFor(cur.toISOString().slice(0, 10));
    const interest = (principal * periodRate * days) / 100 / 365;
    interestRemaining -= interest;
    if (interestRemaining < 0.005) interestRemaining = 0;
    periods.push({
      period: p++,
      startDate: cur.toISOString().slice(0, 10),
      endDate: periodEnd.toISOString().slice(0, 10),
      days,
      rate: periodRate,
      interestPaid: parseFloat(interest.toFixed(2)),
      principalBalance: principal,
      interestBalance: parseFloat(interestRemaining.toFixed(2)),
      dueDate: periodEnd.toISOString().slice(0, 10),
    });
    cur = new Date(periodEnd);
    cur.setDate(cur.getDate() + 1);
    if (cur > end) break;
  }
  return periods;
}

export function totalDays(txDate: string, maturity: string): number {
  if (!txDate || !maturity) return 0;
  return daysBetween(new Date(txDate), new Date(maturity));
}

export function totalInterest(
  principal: number,
  rateOrCards: number | RateCard[],
  txDate: string,
  maturity: string,
): number {
  if (!principal || !txDate || !maturity) return 0;
  // Sum total interest across periods (handles multi-rate)
  return buildPNSchedule(principal, rateOrCards, txDate, maturity)
    .slice(1)
    .reduce((s, p) => s + p.interestPaid, 0);
}

/**
 * Accrued interest up to a given accrual date (default today).
 * Used by Roll Over to compute "interest carried forward".
 */
export function accruedInterest(
  principal: number,
  ratePct: number,
  txDate: string,
  accrueTo: string,
): number {
  if (!principal || !ratePct || !txDate || !accrueTo) return 0;
  const start = new Date(txDate);
  const end = new Date(accrueTo);
  if (end <= start) return 0;
  return principal * ratePct / 100 / 365 * daysBetween(start, end);
}
