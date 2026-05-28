// =====================================================================
// L/C fee amortization — daily-prorated monthly recognition
// Mirrors the LG/BG prepaid-fee schedule. The upfront fee is recognised over the L/C life
// (issue → expiry) by actual day-count, one bucket per calendar month.
// Period 0 = fee paid upfront (Dr Prepaid L/C Fee / Cr Bank Payable)
// Period 1..N = monthly recognition (Dr Fee Expense / Cr Prepaid L/C Fee)
// =====================================================================

export interface LCFeeRow {
  period: number;
  paymentDate: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  feeAmount: number;
  remaining: number;
}

// Local-timezone-safe ISO (YYYY-MM-DD) — avoids UTC off-by-one shift.
function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildLCFeeSchedule(issueDate: string, expiryDate: string, totalFee: number): LCFeeRow[] {
  if (!issueDate || !expiryDate || !totalFee) return [];
  const start = new Date(issueDate);
  const end = new Date(expiryDate);
  if (end <= start) return [];

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (totalDays <= 0) return [];
  const dailyRate = totalFee / totalDays;

  const rows: LCFeeRow[] = [
    { period: 0, paymentDate: issueDate, startDate: null, endDate: null, days: null, feeAmount: totalFee, remaining: totalFee },
  ];

  let cur = new Date(start);
  let remaining = totalFee;
  let p = 1;
  while (cur < end) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const periodEnd = monthEnd > end ? end : monthEnd;
    const actualDays = p === 1
      ? Math.round((periodEnd.getTime() - start.getTime()) / 86400000)
      : Math.round((periodEnd.getTime() - cur.getTime()) / 86400000) + 1;
    const amt = parseFloat((dailyRate * actualDays).toFixed(2));
    remaining = parseFloat((remaining - amt).toFixed(2));
    if (remaining < 0) remaining = 0;
    rows.push({
      period: p++,
      paymentDate: null,
      startDate: toLocalISO(cur),
      endDate: toLocalISO(periodEnd),
      days: actualDays,
      feeAmount: amt,
      remaining,
    });
    cur = new Date(periodEnd);
    cur.setDate(cur.getDate() + 1);
    if (cur > end) break;
  }

  // Compensate rounding so the final period zeroes out exactly.
  if (rows.length > 1) {
    const recognised = rows.slice(1).reduce((s, r) => s + r.feeAmount, 0);
    const diff = parseFloat((totalFee - recognised).toFixed(2));
    if (Math.abs(diff) >= 0.01) {
      const last = rows[rows.length - 1];
      last.feeAmount = parseFloat((last.feeAmount + diff).toFixed(2));
      last.remaining = 0;
    }
  }
  return rows;
}
