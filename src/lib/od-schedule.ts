// Overdraft schedule — daily interest based on ending balance from Bank Transactions.
// Logic:
// - balance >= 0 → interest = 0 (มีเงินคงเหลือ ไม่ใช้ OD)
// - abs(balance) <= facility AMOUNT → ใช้ normal rate
// - abs(balance) > facility AMOUNT → blended:
// portion within AMOUNT × normalRate
// portion exceeds AMOUNT × overlimitRate (สูงกว่า)
// Per day, summed monthly for JE accrual + auto-reverse next month.

export interface ODDailyRow {
  date: string;
  endingBalance: number; // negative = OD used
  ratePct: number; // effective base rate
  overlimitRatePct: number; // overlimit rate (for portion exceeding facility)
  interest: number; // accumulated interest for `days` days
  overLimit: boolean; // true if abs(balance) > facility amount
  overLimitAmount: number; // excess amount over facility
  days: number; // number of days this balance is held (until next tx, or end of month)
  dailyInterest: number; // interest per single day (for tooltip / debug)
}

export interface ODMonthSummary {
  year: number;
  month: number; // 1..12
  monthLabel: string; // "Sep 2024"
  totalInterest: number;
  endingBalance: number; // last day of month
  rate: number;
  totalEndingBalance: number; // = endingBalance - totalInterest
}

/**
 * Build daily interest rows from bank transactions
 * @param transactions bank tx rows ordered by date asc
 * @param ratePct normal effective interest rate (%/year)
 * @param facilityAmount approved OD facility limit (positive number, e.g. 20,000,000)
 * @param overlimitRatePct overlimit rate (%/year) — applied to portion exceeding facility
 */
export function buildODDailyRows(
  transactions: { tx_date: string; ending_balance: number }[],
  ratePct: number,
  facilityAmount: number = 0,
  overlimitRatePct: number = 0,
): ODDailyRow[] {
  if (!transactions || transactions.length === 0 || !ratePct) return [];

  // ยุบให้เหลือวันละแถวเดียว โดยใช้ยอดคงเหลือของรายการสุดท้ายในวันนั้น = ยอดสิ้นวัน
  //
  // เดิมแปลงรายการเดินบัญชีทุกบรรทัดเป็น 1 แถว แล้วแต่ละแถวคิดอย่างน้อย 1 วันเต็ม
  // วันที่มีรายการ 5 บรรทัดจึงถูกคิดดอกเบี้ยประมาณ 5 เท่าของความจริง
  // ธนาคารคิดดอกเบี้ยเบิกเกินบัญชีจากยอดคงเหลือสิ้นวัน วันละครั้ง
  const byDay = new Map<string, number>();
  for (const t of transactions) {
    // ลำดับที่เข้ามาเรียงตามวันอยู่แล้ว รายการหลังของวันเดียวกันจะทับค่าเดิม = ยอดสิ้นวัน
    byDay.set(t.tx_date, Number(t.ending_balance) || 0);
  }
  const sorted = [...byDay.entries()]
    .map(([tx_date, ending_balance]) => ({ tx_date, ending_balance }))
    .sort((a, b) => a.tx_date.localeCompare(b.tx_date));

  // Use local-midnight to avoid timezone-of-day mismatch (Bangkok UTC+7)
  const parseLocal = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

  return sorted.map((t, i) => {
    const balance = Number(t.ending_balance) || 0;
    const thisDate = parseLocal(t.tx_date);

    // ช่วงที่แถวนี้ครอบคลุม (นับวันเริ่ม ไม่นับวันจบ)
    // - ไม่ใช่แถวสุดท้าย: ถึงวันของรายการถัดไป แต่ไม่เกินสิ้นเดือนของแถวนี้
    // - แถวสุดท้าย: คิดแค่วันเดียว
    //
    // เดิมแถวสุดท้ายลากยาวถึงสิ้นเดือนเสมอ ทั้งที่ไม่มีข้อมูลธนาคารช่วงนั้น
    // ถ้าใบแจ้งยอดมีถึงวันที่ 10 ระบบจะคิดดอกเบี้ยของยอดวันที่ 10 ต่อไปจนถึงสิ้นเดือน
    const endOfMonthExclusive = new Date(thisDate.getFullYear(), thisDate.getMonth() + 1, 1);
    let periodEnd: Date;
    if (i < sorted.length - 1) {
      const nextDate = parseLocal(sorted[i + 1].tx_date);
      periodEnd = nextDate < endOfMonthExclusive ? nextDate : endOfMonthExclusive;
    } else {
      periodEnd = new Date(thisDate.getFullYear(), thisDate.getMonth(), thisDate.getDate() + 1);
    }
    const days = Math.max(1, dayDiff(thisDate, periodEnd));

    let dailyInterest = 0;
    let overLimit = false;
    let overLimitAmount = 0;
    if (balance < 0) {
      const utilized = Math.abs(balance);
      if (facilityAmount > 0 && utilized > facilityAmount) {
        // Blended: portion within limit at normal rate + excess at overlimit rate
        const within = facilityAmount;
        const excess = utilized - facilityAmount;
        const effectiveOverlimit = overlimitRatePct > 0 ? overlimitRatePct : ratePct;
        dailyInterest = (within * ratePct) / 100 / 365 + (excess * effectiveOverlimit) / 100 / 365;
        overLimit = true;
        overLimitAmount = excess;
      } else {
        // Within facility (or no limit set) → normal rate
        dailyInterest = (utilized * ratePct) / 100 / 365;
      }
    }
    return {
      date: t.tx_date,
      endingBalance: balance,
      ratePct,
      overlimitRatePct: overlimitRatePct || ratePct,
      interest: parseFloat((dailyInterest * days).toFixed(2)),
      overLimit,
      overLimitAmount: parseFloat(overLimitAmount.toFixed(2)),
      days,
      dailyInterest: parseFloat(dailyInterest.toFixed(4)),
    };
  });
}

/**
 * Aggregate daily rows into monthly summary
 */
export function buildODMonthSummary(rows: ODDailyRow[]): ODMonthSummary[] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, ODMonthSummary>();
  for (const r of rows) {
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const existing = map.get(key) ?? {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      monthLabel,
      totalInterest: 0,
      endingBalance: 0,
      rate: r.ratePct,
      totalEndingBalance: 0,
    };
    existing.totalInterest += r.interest;
    existing.endingBalance = r.endingBalance; // last value wins (asc sort)
    existing.rate = r.ratePct;
    map.set(key, existing);
  }
  return Array.from(map.values()).map((m) => ({
    ...m,
    totalInterest: parseFloat(m.totalInterest.toFixed(2)),
    totalEndingBalance: parseFloat((m.endingBalance - m.totalInterest).toFixed(2)),
  }));
}

export function odTotalInterest(rows: ODDailyRow[]): number {
  return parseFloat(rows.reduce((s, r) => s + r.interest, 0).toFixed(2));
}

export function odLastEndingBalance(rows: ODDailyRow[]): number {
  if (rows.length === 0) return 0;
  return rows[rows.length - 1].endingBalance;
}
