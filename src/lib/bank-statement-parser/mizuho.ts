// Mizuho (มิซูโฮ) statement parser — exported from the bank as .xls (Crystal
// Reports). readBankFile() flattens the sheet to CSV via SheetJS first, so this
// parser works on the CSV text like the others.
//
// Layout (header row carries the column names; several spacer columns in
// between are blank, so we map by HEADER NAME, not by fixed position):
//
//   No | Ref_no | Booking_Date | Value_Date | | Name | | | Currency |
//   Ac_Code | Ac_no | | DR | | CR | | END_BAL | | Remarks
//
//   1 | B/F       | 24/09/26 | 24/09/26 | | X MOBILITY … | BAHT | 20204 |
//     H15764185035 | | | | | 19997566.61 | |
//   36 | CQD036441 | 24/09/26 | … | | | 150000000.00 | 158585809.66 | | CQDI
//
// Notes:
//  - Booking_Date is dd/MM/yy (2-digit year → 20yy).
//  - DR = debit (money out) · CR = credit (money in) · END_BAL = running
//    balance (can be negative when overdrawn).
//  - Ac_no is alphanumeric (e.g. 'H15764185035').
//  - Ref_no is the bank's per-row reference (ACC…/PSR…/CQD…) → kept as txn_code.
//  - Remarks carries the narrative + any reference numbers (e.g.
//    'PPS FR 004 2153133568') used to auto-link to a facility.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTHS_CODE: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "24/09/26" (dd/MM/yy) → "2026-09-24". Also accepts dd/MM/yyyy and ISO. */
export function parseMizuhoDate(s: string): string | null {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = t.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  let yy = parseInt(y, 10);
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (yy < 100) yy += 2000; // dd/MM/yy → 20yy
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function parseMizuho(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('Mizuho: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หาแถวหัวตาราง (map ด้วยชื่อคอลัมน์ — ไฟล์มี spacer columns ว่างคั่น)
  let hr = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(allLines.length, 8); i++) {
    const cols = splitCsvLine(allLines[i]).map((c) => c.trim());
    if (cols.includes('Ref_no') && cols.includes('Booking_Date')) {
      hr = i;
      headers = cols;
      break;
    }
  }
  if (hr < 0) throw new Error(HEADER_NOT_FOUND);

  const col = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iRef = col('Ref_no');
  const iDate = col('Booking_Date');
  const iAcc = col('Ac_no');
  const iDr = col('DR');
  const iCr = col('CR');
  const iBal = col('END_BAL');
  const iRemark = col('Remarks');
  const iName = col('Name');
  // หัวตารางต้องมีคอลัมน์หลักครบ (FR-MST-BS-013)
  if ([iRef, iDate, iAcc, iDr, iCr, iBal].some((x) => x < 0)) {
    throw new Error(HEADER_NOT_FOUND);
  }

  const rows: ParsedLine[] = [];
  let accountNo = '';

  for (let i = hr + 1; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i]);
    const iso = parseMizuhoDate(cols[iDate] ?? '');
    if (!iso) continue;

    if (!accountNo) accountNo = (cols[iAcc] ?? '').trim();

    const debit = parseAmount(cols[iDr]);
    const credit = parseAmount(cols[iCr]);
    const balance = parseAmount(cols[iBal]);
    const description = (iRemark >= 0 ? cols[iRemark] ?? '' : '').trim();
    const txn_code = (cols[iRef] ?? '').trim() || undefined;

    const extras = [iName >= 0 ? cols[iName] : '']
      .map((c) => (c ?? '').trim())
      .filter(Boolean);
    const raw_remark = extras.length ? extras.join(' · ') : undefined;

    rows.push({
      tx_date: iso,
      txn_code,
      description,
      debit,
      credit,
      balance,
      raw_remark,
    });
  }

  if (rows.length === 0) {
    throw new Error('Mizuho: ไม่พบรายการในไฟล์');
  }
  if (!accountNo) {
    throw new Error('Mizuho: ไม่พบเลขที่บัญชีในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM

  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTHS_CODE[mm] ?? mm;
  const statement_name = `Mizuho ${monthLabel} ${yy}`;

  return {
    bank: 'MIZUHO',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
