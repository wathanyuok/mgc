// Promissory Note / Trust Receipt schedule calculation
// Logic: for each period between tx_date → month-end → ... → maturity_date
// Interest = Principal × Rate% / 365 × days
// Multi-rate: when rate_cards array passed, each period uses rate based on its start date

import { computePeriodInterestSplit, pickEffectiveRate } from './rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

export interface PNSchedulePeriod {
  period: number;
  startDate: string;
  endDate: string; // ขอบงวด (Due boundary) — ใช้คำนวณ/วันเริ่มงวดถัดไป
  // MoM 30Sep2026: วันสิ้นสุดงวดที่แสดง = ขอบงวด − 1 วัน (เริ่ม 15 → สิ้นสุด 14) ไม่ใช่ 15→15
  coverageEndDate: string;
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

/** แปลงวันที่รูปแบบ YYYY-MM-DD เป็นเที่ยงคืนตามเขตเวลาเครื่อง
 *
 *  new Date('2026-12-31') ให้เที่ยงคืนตามเวลามาตรฐานโลก แต่ตัวหาวันสิ้นเดือน
 *  ให้เที่ยงคืนตามเขตเวลาเครื่อง · ถ้าปนกันจะเทียบไม่เท่ากันพอดี
 *  ผลคือสัญญาที่ครบกำหนดวันสิ้นเดือนจะได้งวดท้ายที่ยาว 0 วันติดมา
 */
function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * วันสิ้นงวดถัดไป — สิ้นเดือนของเดือนที่นับจากวันถัดจากวันสิ้นงวดปัจจุบัน
 *
 * ต้องบวก 1 วันก่อนหาสิ้นเดือน เพราะงวดใหม่เริ่มวันเดียวกับที่งวดเก่าจบ
 * ถ้าไม่บวก พอวันเริ่มงวดเป็นวันสิ้นเดือนอยู่แล้ว จะได้วันเดิมกลับมา งวดยาว 0 วัน
 *
 * ตัวอย่าง  1 มิ.ย. → 30 มิ.ย. · 30 มิ.ย. → 31 ก.ค. · 31 ก.ค. → 31 ส.ค.
 */
function nextPeriodEnd(d: Date): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  return new Date(t.getFullYear(), t.getMonth() + 1, 0);
}

/** Days between two dates — EXCLUSIVE (b − a, in calendar days).
 *  Matches bank actual practice (their Loan Calc Table shows Jan 1 → Jan 31 = 30 days,
 *  not 31). Daily interest = Principal × Rate × days/365 then accrues each calendar day. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Local-timezone-safe ISO date (YYYY-MM-DD). Avoids the off-by-one shift
 *  caused by Date.toISOString() converting to UTC for non-UTC timezones. */
function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build schedule periods:
 * Period 0: information row (tx → tx, total interest = sum of period interests)
 * Period 1..N: interest-accrual periods, each ending at month-end (except last = maturity)
 *
 * @param rateOrCards either single number (legacy) OR RateCard[] (multi-rate)
 */
/** งวดที่ผู้ใช้พิมพ์ทับ (แก้ตารางเอง แบบ Loan) — ดอกต่องวด และ/หรือ เงินต้นคงเหลือ */
export interface PNScheduleOverride {
  period: number;
  interest?: number;          // ดอกเบี้ยต่องวด (Interest Paid)
  principalBalance?: number;  // เงินต้นคงเหลือ (Principal Bal.)
}

export function buildPNSchedule(
  principal: number,
  rateOrCards: number | RateCard[],
  txDate: string,
  maturity: string,
  overrides?: PNScheduleOverride[],
): PNSchedulePeriod[] {
  if (!principal || !txDate || !maturity) return [];
  const cards = Array.isArray(rateOrCards) ? rateOrCards : null;
  const singleRate = typeof rateOrCards === 'number' ? rateOrCards : 0;

  // Empty cards & no single rate → nothing
  if (!cards?.length && !singleRate) return [];

  const start = parseLocal(txDate);
  const end = parseLocal(maturity);
  if (end <= start) return [];

  // Helper: get rate for a given date
  const rateFor = (dateStr: string): number => {
    if (cards) return pickEffectiveRate(cards, dateStr).rate;
    return singleRate;
  };

  const round2 = (n: number) => parseFloat(n.toFixed(2));
  const ovMap = new Map((overrides ?? []).map((o) => [o.period, o]));

  // ── เก็บงวดดิบ (วันที่/วัน/อัตรา/ดอกคำนวณ) ไว้ก่อน ──
  // CAL-LOAN-18 / MoM Day 3 §115: split ดอกเมื่ออัตราเปลี่ยนกลางงวด · ปัดเศษรายงวด
  type Raw = { startDate: string; endDate: string; days: number; rate: number; interest: number };
  const raw: Raw[] = [];
  {
    let cur = new Date(start);
    while (cur < end) {
      const next = nextPeriodEnd(cur);
      const periodEnd = next > end ? end : next;
      raw.push({
        startDate: toLocalISO(cur),
        endDate: toLocalISO(periodEnd),
        days: daysBetween(cur, periodEnd),
        rate: rateFor(toLocalISO(cur)),
        interest: round2(computePeriodInterestSplit(cards, singleRate, toLocalISO(cur), toLocalISO(periodEnd), principal)),
      });
      cur = new Date(periodEnd);
    }
  }

  // ── ใส่ค่าที่ผู้ใช้พิมพ์ทับ (ดอกต่องวด) แล้วรวมเป็นดอกทั้งตาราง ──
  const appliedInterest = raw.map((r, i) => {
    const ov = ovMap.get(i + 1);
    return ov?.interest != null ? round2(ov.interest) : r.interest;
  });
  const totalInterest = round2(appliedInterest.reduce((s, v) => s + v, 0));

  const periods: PNSchedulePeriod[] = [
    {
      period: 0,
      startDate: txDate,
      endDate: txDate,
      coverageEndDate: txDate,
      days: 0,
      rate: 0,
      interestPaid: 0,
      principalBalance: principal,
      interestBalance: round2(totalInterest),
      dueDate: '',
    },
  ];

  let interestRemaining = totalInterest;
  // Principal Bal. ไหลต่อเนื่อง (carry forward) แบบ Loan — แก้งวดไหน งวดถัดไปรับยอดนั้นต่อ
  // (bullet ปกติคงที่ = principal ทุกงวด · ถ้าพิมพ์ทับงวดใด งวดหลังจากนั้นใช้ยอดใหม่จนกว่าจะทับอีก)
  let runningPB = principal;
  raw.forEach((r, i) => {
    const interest = appliedInterest[i];
    interestRemaining = round2(interestRemaining - interest);
    if (interestRemaining < 0.005) interestRemaining = 0;
    const ov = ovMap.get(i + 1);
    const pb = ov?.principalBalance != null ? round2(ov.principalBalance) : runningPB;
    runningPB = pb;
    periods.push({
      period: i + 1,
      startDate: r.startDate,
      endDate: r.endDate,
      // MoM 30Sep2026: วันสิ้นสุดงวดที่แสดง = ขอบงวด − 1 วัน (เริ่ม 15 → สิ้นสุด 14)
      coverageEndDate: toLocalISO(new Date(parseLocal(r.endDate).getFullYear(), parseLocal(r.endDate).getMonth(), parseLocal(r.endDate).getDate() - 1)),
      days: r.days,
      rate: r.rate,
      interestPaid: round2(interest),
      principalBalance: pb,
      interestBalance: round2(interestRemaining),
      dueDate: r.endDate,
    });
  });
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
  const start = parseLocal(txDate);
  const end = parseLocal(accrueTo);
  if (end <= start) return 0;
  return principal * ratePct / 100 / 365 * daysBetween(start, end);
}
