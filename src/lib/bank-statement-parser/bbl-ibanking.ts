// BBL iBanking CSV statement parser (คนละฟอร์แมตกับ bbl.ts ที่เป็น .xls
// "ACCOUNT ACTIVITY HISTORY REPORT").
//
// Export จาก BBL iBanking — pipe-delimited (|) · cp874 · วันที่ไทย พ.ศ.:
//
//   วันที่ทำรายการ|วันที่มีผล|คำอธิบาย|หักบัญชี|เข้าบัญชี|ยอดคงเหลือ|ช่องทางทำรายการ|
//   04 ส.ค. 2569 10:23|04 ส.ค. 2569|รับเงินโอนจากบัญชีต่างธนาคาร||1,000.00|326,236.24|MOB|
//   09 ส.ค. 2569 17:03|09 ส.ค. 2569|ชำระค่าบัตรเครดิต|314,620.69|-314,620.69|240,395.55|AUTO|
//
// Notes:
//  - วันที่ = "DD <เดือนย่อไทย> <พ.ศ.> HH:MM" — แปลง พ.ศ.→ค.ศ. (ปี − 543).
//  - หักบัญชี = debit · เข้าบัญชี = credit · ถ้าหักบัญชีมีค่า = รายการ debit
//    (คอลัมน์เข้าบัญชีของแถว debit โชว์ยอดติดลบซ้ำ — ไม่ใช้).
//  - ไฟล์ไม่มีคอลัมน์ "เลขที่บัญชี" — คืน account_no ว่าง ให้ผู้ใช้กรอกในฟอร์ม.

import { parseAmount } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTH: Record<string, string> = {
  'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04',
  'พ.ค.': '05', 'มิ.ย.': '06', 'ก.ค.': '07', 'ส.ค.': '08',
  'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12',
};

const THAI_MONTH_LABEL: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "04 ส.ค. 2569 10:23" → { iso:'2026-08-04', time:'10:23' } (พ.ศ.→ค.ศ.). */
export function parseBBLibDate(s: string): { iso: string; time?: string } | null {
  const m = s.trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (!m) return null;
  const [, d, monthThai, yearBE, time] = m;
  const mm = THAI_MONTH[monthThai];
  if (!mm) return null;
  let year = parseInt(yearBE, 10);
  if (!Number.isFinite(year)) return null;
  // พ.ศ. → ค.ศ. · heuristic: ปี ≥ 2400 = พ.ศ.แน่ (ค.ศ. ยังไม่ถึง) → ลบ 543
  // ไม่งั้นถือว่าเป็น ค.ศ. อยู่แล้ว (เผื่อ BBL เปลี่ยนไปส่งปี ค.ศ.)
  if (year >= 2400) year -= 543;
  return {
    iso: `${String(year).padStart(4, '0')}-${mm}-${d.padStart(2, '0')}`,
    time: time || undefined,
  };
}

export function parseBBLiBanking(csvText: string): ParsedBankStatement {
  const allLines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('BBL: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หาแถวหัวตาราง (pipe-delimited) — ต้องมีคอลัมน์หลักครบ (FR-MST-BS-013)
  let hr = -1;
  for (let i = 0; i < Math.min(allLines.length, 6); i++) {
    const h = allLines[i].replace(/^﻿/, '');
    if (h.includes('วันที่ทำรายการ') && h.includes('หักบัญชี') && h.includes('เข้าบัญชี')) {
      hr = i;
      break;
    }
  }
  if (hr < 0) throw new Error(HEADER_NOT_FOUND);

  const rows: ParsedLine[] = [];
  for (let i = hr + 1; i < allLines.length; i++) {
    const cols = allLines[i].split('|');
    if (cols.length < 6) continue;

    // 0: วันที่ทำรายการ(+เวลา) · 1: วันที่มีผล · 2: คำอธิบาย · 3: หักบัญชี(debit) ·
    // 4: เข้าบัญชี(credit) · 5: ยอดคงเหลือ · 6: ช่องทางทำรายการ
    const parsed = parseBBLibDate(cols[0] ?? '');
    if (!parsed) continue;

    const drRaw = (cols[3] ?? '').trim();
    const debit = drRaw ? parseAmount(drRaw) : 0;
    // แถว debit คอลัมน์เข้าบัญชีโชว์ยอดติดลบซ้ำ — ใช้ credit เฉพาะเมื่อไม่มี debit
    const credit = debit > 0 ? 0 : parseAmount(cols[4]);
    const balance = parseAmount(cols[5]);
    const description = (cols[2] ?? '').trim();
    const channel = (cols[6] ?? '').trim() || undefined;

    rows.push({
      tx_date: parsed.iso,
      tx_time: parsed.time,
      description,
      debit,
      credit,
      balance,
      channel,
    });
  }

  if (rows.length === 0) {
    throw new Error('BBL: ไม่พบรายการในไฟล์');
  }

  const ordered = reorderByBalanceChain(rows);

  const minDate = ordered.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), ordered[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTH_LABEL[mm] ?? mm;
  const statement_name = `BBL ${monthLabel} ${yy}`;

  return {
    bank: 'BBL',
    account_no: '', // ไฟล์ iBanking ไม่มีคอลัมน์เลขบัญชี — ผู้ใช้กรอกในฟอร์ม
    statement_period: statementPeriod,
    statement_name,
    lines: ordered,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * BBL iBanking เรียงรายการที่ "เวลาเดียวกัน" สลับลำดับ ทำให้ยอดคงเหลือแถวติดกัน
 * ไม่ตรงสูตร (prev ± amount) ทั้งที่ค่าแต่ละแถวถูก. จัดเรียงใหม่ตาม chain ของยอด
 * คงเหลือ: แถวถัดไปคือแถวที่ "ยอดก่อนหน้า" (balance − credit + debit) เท่ากับยอด
 * คงเหลือของแถวปัจจุบัน. ทำเฉพาะเมื่อ chain สมบูรณ์แบบ 1 เส้นครบทุกแถว — ไม่งั้น
 * คืนลำดับเดิม (ปลอดภัยเมื่อไฟล์มี gap / ยอดซ้ำ / รายการขาด).
 */
function reorderByBalanceChain(rows: ParsedLine[]): ParsedLine[] {
  if (rows.length < 2) return rows;
  const prevBal = (r: ParsedLine) => round2(r.balance - r.credit + r.debit);
  // map: "ยอดก่อนหน้า" → แถว · ถ้าซ้ำ = กำกวม → ไม่จัดเรียง
  const byPrev = new Map<number, ParsedLine>();
  for (const r of rows) {
    const p = prevBal(r);
    if (byPrev.has(p)) return rows;
    byPrev.set(p, r);
  }
  const balSet = new Set(rows.map((r) => round2(r.balance)));
  // แถวเปิด = แถวที่ "ยอดก่อนหน้า" ไม่ตรงกับ balance ของแถวใด (= ยอดยกมาของ statement)
  const openings = [...byPrev.keys()].filter((p) => !balSet.has(p));
  if (openings.length !== 1) return rows;

  const order: ParsedLine[] = [];
  const seen = new Set<ParsedLine>();
  let cur: ParsedLine | undefined = byPrev.get(openings[0]);
  while (cur && !seen.has(cur)) {
    order.push(cur);
    seen.add(cur);
    cur = byPrev.get(round2(cur.balance));
  }
  return order.length === rows.length ? order : rows;
}
