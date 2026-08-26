// =====================================================================
// L/C fee amortization — daily-prorated monthly recognition
// Mirrors the LG/BG prepaid-fee schedule. The upfront fee is recognised over the L/C life
// (issue → expiry) by actual day-count, one bucket per calendar month.
// Period 0 = fee paid upfront (Dr Prepaid L/C Fee / Cr Bank Payable)
// Period 1..N = monthly recognition (Dr Fee Expense / Cr Prepaid L/C Fee)
// =====================================================================

// ---------------------------------------------------------------------
// ค่าธรรมเนียม L/C ทั้งฉบับ — สูตรกลางที่ทุกที่ต้องใช้ร่วมกัน
//
// เดิมสูตรนี้อยู่ในหน้าจอ L/C ที่เดียว ส่วนตารางผ่อนกลางคิดเองแบบย่อ
// (เอายอด × อัตรา เฉยๆ ไม่สนวิธีคิดค่าธรรมเนียมและค่าธรรมเนียมแรกเข้า)
// ทำให้รายงานครบกำหนด รายงานค้างชำระ และการแจ้งเตือน ใช้ตัวเลขที่ไม่ตรงกับใบสำคัญบัญชี
//
// วิธีคิดมี 2 แบบ:
//   • คิดเต็มอายุสัญญา       — ค่าธรรมเนียม = ยอดเงิน × อัตรา
//   • คิดตามจำนวนวันที่ใช้จริง — ค่าธรรมเนียมแรกเข้า + (ยอดเงิน × อัตรา × จำนวนวัน ÷ 365)
//
// ตัวอย่าง: ยอด 10,000,000 · อัตรา 1% · ค่าธรรมเนียมแรกเข้า 5,000 · อายุ 90 วัน
//   คิดเต็มอายุ        → 100,000.00
//   คิดตามวันที่ใช้จริง → 5,000 + (100,000 × 90 ÷ 365) = 29,657.53
// ---------------------------------------------------------------------
export interface LCFeeInput {
  amount?: number | null;          // ยอดเงินสัญญา (บาท)
  fee_rate?: number | null;        // อัตราค่าธรรมเนียม (%)
  fee_mode?: string | null;        // 'engagement_prorated' = คิดตามวันที่ใช้จริง
  engagement_fee?: number | null;  // ค่าธรรมเนียมแรกเข้า
  term_days?: number | null;       // จำนวนวันของสัญญา
}

export interface LCFeeBreakdown {
  fee: number;        // ค่าธรรมเนียมรวมที่ต้องจ่าย
  ratePart: number;   // ส่วนที่คิดจากอัตรา (ก่อนเฉลี่ยตามวัน)
  prorated: number;   // ส่วนที่เฉลี่ยตามวันแล้ว
}

export function calcLCFee(r: LCFeeInput): LCFeeBreakdown {
  const base = Number(r.amount ?? 0);
  const ratePart = (base * Number(r.fee_rate ?? 0)) / 100;
  if (r.fee_mode === 'engagement_prorated') {
    const days = Number(r.term_days ?? 0);
    const prorated = (ratePart * days) / 365;
    return { fee: Number(r.engagement_fee ?? 0) + prorated, ratePart, prorated };
  }
  return { fee: ratePart, ratePart, prorated: ratePart };
}

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

  // Exclusive day count — matches bank actual practice (Jan 1 → Dec 31 = 364 days span)
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
    // Exclusive day count matching bank convention
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
