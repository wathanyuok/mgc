// =====================================================================
//  IFRS 16 — ROU Asset depreciation schedule (straight-line)
//  MoM Day4 §5 + §8:
//    - "ROU Asset — Amortize แบบเส้นตรง (จำนวนเท่ากันทุกงวด)"
//    - ค่าเสื่อมเริ่ม run ตั้งแต่ Day 1 / งวดแรก (แม้อยู่ใน Grace Period)
//    - ROU Asset Useful Life อาจไม่เท่ากับ Lease Liability Term — ใช้ field แยก
//    - Depreciation = ROU initial / useful life (months) เท่ากันทุกงวด
//      JE: Dr Depreciation Expense / Cr Accumulated Depreciation – ROU
//    - คำนวณแบบ Monthly (ไม่ daily) ตาม MoM Day4 §10
//  NBV (Net Book Value) = ROU initial − Accumulated Depreciation
// =====================================================================

export interface RouDepreciationInput {
  rouInitial: number;     // ตั้งต้น ROU Asset (มัก = principal/net cost; +prepaid carry-over)
  usefulLifeMonths: number; // อายุการใช้งาน ROU (เดือน) — fallback = term
  startDate: string;      // ISO yyyy-mm-dd (วันเริ่มสัญญา / Day 1)
  payEom?: boolean;       // snap งวดเป็นสิ้นเดือน
}

export interface RouDepreciationRow {
  period: number;
  date: string;
  beginNbv: number;
  depreciation: number;
  accumDepreciation: number;
  endNbv: number;
}

export interface RouDepreciationResult {
  rows: RouDepreciationRow[];
  monthlyDepreciation: number;
  usefulLifeMonths: number;
  totalDepreciation: number;
}

// Period-end date with short-month clamp (mirrors loan-schedule.periodDate).
function periodDate(base: Date, k: number, payEom: boolean): Date {
  const monthIndex = base.getMonth() + k;
  const targetYear = base.getFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  if (payEom) return new Date(targetYear, targetMonth, lastDay);
  return new Date(targetYear, targetMonth, Math.min(base.getDate(), lastDay));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildRouDepreciation(input: RouDepreciationInput): RouDepreciationResult {
  const empty: RouDepreciationResult = {
    rows: [], monthlyDepreciation: 0, usefulLifeMonths: 0, totalDepreciation: 0,
  };
  const rou = Math.max(0, input.rouInitial || 0);
  const n = Math.max(1, Math.round(input.usefulLifeMonths || 0));
  if (rou <= 0 || !input.startDate) return empty;

  const payEom = !!input.payEom;
  const base = new Date(input.startDate);
  const monthly = rou / n;

  const rows: RouDepreciationRow[] = [];
  let accum = 0;
  for (let i = 1; i <= n; i++) {
    const beginNbv = rou - accum;
    // Last period absorbs any rounding so endNbv lands exactly on 0.
    const dep = i === n ? beginNbv : monthly;
    accum += dep;
    rows.push({
      period: i,
      date: iso(periodDate(base, i, payEom)),
      beginNbv,
      depreciation: dep,
      accumDepreciation: accum,
      endNbv: rou - accum,
    });
  }

  return {
    rows,
    monthlyDepreciation: monthly,
    usefulLifeMonths: n,
    totalDepreciation: accum,
  };
}

// NBV at an arbitrary number of elapsed periods (for Asset Transfer default amount).
export function rouNbvAtPeriod(result: RouDepreciationResult, rouInitial: number, elapsedPeriods: number): number {
  if (result.rows.length === 0) return Math.max(0, rouInitial);
  const k = Math.max(0, Math.min(result.rows.length, Math.floor(elapsedPeriods)));
  if (k === 0) return Math.max(0, rouInitial);
  return Math.max(0, result.rows[k - 1].endNbv);
}
