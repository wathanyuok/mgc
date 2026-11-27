// Floor Plan schedule calculation — Curtailment milestones from Curtailment master
// Default, 180 (10%), 270 (80%) from drawdown.
// Interest = Outstanding Principal × Rate / 365 × Days in period.
// Multi-rate: when rate_cards passed, each period uses rate based on its start date

import { computePeriodInterestSplit, pickEffectiveRate } from './rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

export interface CurtailmentMilestone {
  day: number;
  pct: number;
}

export interface FPSchedulePeriod {
  period: number;
  startDate: string;
  endDate: string; // ขอบงวด (Due boundary) — ใช้คำนวณ/ลง JE
  // MoM 30Sep2026: วันสิ้นสุดงวดที่แสดง = ขอบงวด − 1 วัน (เริ่ม 15 → สิ้นสุด 14) ไม่ใช่ 15→15
  coverageEndDate: string;
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
/** งวดที่ผู้ใช้พิมพ์ทับ (แก้ตารางเอง แบบ Loan/PN) */
export interface FPScheduleOverride {
  period: number;
  interest?: number;          // ดอกเบี้ยต่องวด
  curtailAmount?: number;     // ยอดลดต้น (Curtailment) งวดนั้น
  principalBalance?: number;  // เงินต้นคงเหลือ
}

export function buildFPSchedule(
  principal: number,
  rateOrCards: number | RateCard[],
  txDate: string,
  maturity: string,
  mode: 'bmw' | 'other',
  milestones?: CurtailmentMilestone[],
  overrides?: FPScheduleOverride[],
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
    // สิ้นเดือนของเดือนถัดไป — งวดใหม่เริ่มวันเดียวกับที่งวดเก่าจบ
    // ถ้าหาสิ้นเดือนจากวันเดิมตรงๆ พอวันเริ่มเป็นวันสิ้นเดือนอยู่แล้วจะวนไม่จบ
    const probe = addDays(cur, 1);
    const next = endOfMonth(probe);
    const stop = next > end ? end : next;
    boundaries.push(new Date(stop));
    cur = new Date(stop);
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
      coverageEndDate: txDate,
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
  const r2 = (n: number) => parseFloat(n.toFixed(2));
  const ovMap = new Map((overrides ?? []).map((o) => [o.period, o]));

  for (const boundary of boundaries) {
    // Allow boundary === periodStart (e.g. milestone day exactly on period start)
    // so that a 0-day curtailment row is created. Only skip strictly-before boundaries.
    if (boundary < periodStart) continue;
    const thisPeriod = periodNo;
    const ov = ovMap.get(thisPeriod);
    const days = daysBetween(periodStart, boundary);
    const periodRate = rateFor(toISO(periodStart));
    // CAL-LOAN-18 / MoM Day 3 §115: split when rate changes mid-period. · พิมพ์ทับได้
    const interestCalc = computePeriodInterestSplit(cards, singleRate, toISO(periodStart), toISO(boundary), outstandingPrincipal);
    const interest = ov?.interest != null ? r2(ov.interest) : r2(interestCalc);
    interestRemaining -= interest;
    if (interestRemaining < 0.005) interestRemaining = 0;

    // Check if this boundary is a curtailment date
    const curtailHit = curtailDates.find(
      (c) => c.date.getTime() === boundary.getTime(),
    );
    const curtailPct = curtailHit?.pct ?? 0;
    const curtailAmount = ov?.curtailAmount != null ? r2(ov.curtailAmount) : r2(curtailPct > 0 ? (principal * curtailPct) / 100 : 0);
    // เงินต้นคงเหลือ: พิมพ์ทับได้ตรงๆ · ไม่งั้นลดตาม Curtailment (ไหลต่อเนื่อง)
    if (ov?.principalBalance != null) {
      outstandingPrincipal = r2(ov.principalBalance);
    } else {
      if (curtailAmount > 0) outstandingPrincipal -= curtailAmount;
      if (outstandingPrincipal < 0.005) outstandingPrincipal = 0;
    }

    periods.push({
      period: periodNo++,
      startDate: toISO(periodStart),
      endDate: toISO(boundary),
      // MoM 30Sep2026: วันสิ้นสุดงวดที่แสดง = ขอบงวด − 1 วัน (เริ่ม 15 → สิ้นสุด 14)
      coverageEndDate: toISO(new Date(boundary.getFullYear(), boundary.getMonth(), boundary.getDate() - 1)),
      days,
      rate: periodRate,
      curtailPct,
      curtailAmount,
      interest,
      principalBalance: r2(outstandingPrincipal),
      interestBalance: r2(interestRemaining),
    });

    // งวดถัดไปเริ่มวันเดียวกับที่งวดนี้จบ · วันรอยต่อเดือนจึงไม่หายไป
    periodStart = new Date(boundary);
    if (periodStart >= end) break;
  }

  return periods;
}

export function fpTotalInterest(periods: FPSchedulePeriod[]): number {
  return periods.slice(1).reduce((s, r) => s + r.interest, 0);
}

export function fpTotalCurtailment(periods: FPSchedulePeriod[]): number {
  return periods.slice(1).reduce((s, r) => s + r.curtailAmount, 0);
}

// ─── Curtailment แยกรายคัน (MoM 30 ก.ย. บ.1679/1703) ──────────────────
// "ก้อนลดต้นแต่ละงวดเป็นของรถคันไหน" — แตกยอดรวมของแต่ละ milestone ออกเป็นรายคัน
// (คิด % ของยอดเบิกคันนั้น) เพื่อให้ตอนขาย/ปิดรถตัดก้อนของคันนั้นได้ตรง
export interface ChassisCurtailInput {
  chassis_no: string;
  model: string | null;
  amount: number; // ยอดเบิกของคันนั้น (ฐานคิด %)
  status?: string;
}
export interface ChassisCurtailBreakdown {
  chassis_no: string;
  model: string | null;
  amount: number;
  perMilestone: { day: number; pct: number; amount: number }[]; // ลดต้นแต่ละงวดของคันนี้
  total: number; // ลดต้นรวมของคันนี้
}

export function fpCurtailmentByChassis(
  chassisList: ChassisCurtailInput[],
  milestones: CurtailmentMilestone[] | undefined,
): ChassisCurtailBreakdown[] {
  const ms = milestones && milestones.length > 0 ? milestones : DEFAULT_CURTAILMENT;
  const r2 = (n: number) => parseFloat(n.toFixed(2));
  return chassisList
    .filter((c) => c.status !== 'Returned') // รถที่ปลดออกแล้ว ไม่คิด
    .map((c) => {
      const perMilestone = ms.map((m) => ({ day: m.day, pct: m.pct, amount: r2((c.amount * m.pct) / 100) }));
      return {
        chassis_no: c.chassis_no,
        model: c.model,
        amount: c.amount,
        perMilestone,
        total: r2(perMilestone.reduce((s, x) => s + x.amount, 0)),
      };
    });
}
