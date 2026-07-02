// SCB CSV statement parser.
//
// Sample layout (encoding is typically cp874 too — Thai descriptions):
//
//   Line 1 (header):
//     Account Number,Date,Time,Transaction Code,Channel,Cheque Number,
//     Debit Amount,Credit Amount,Balance Sign,Balance Amount,Description
//   Line 2+ (rows):
//     1402534172,01/04/2026,00:21,X1,BCMS,N/A,,"22,338.00", ,"31,728,146.80",
//     Transfer from SCB x5334 บริษัท เนอวาซิส
//
// Notes on the format:
//  - Date is already CE — dd/MM/yyyy.
//  - Amounts may be quoted and thousand-separated: "22,338.00".
//  - "Balance Sign" is either " " (positive) or "-" (negative). We apply the
//    sign to Balance Amount so the DB stores a signed number.
//  - "Cheque Number" is "N/A" when absent — normalize to undefined.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import type { ParsedBankStatement, ParsedLine } from './types';

const THAI_MONTHS_CODE: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "01/04/2026" → "2026-04-01" (CE already). */
export function parseSCBDate(s: string): string | null {
  const trimmed = s.trim();
  const parts = trimmed.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const yy = parseInt(y, 10);
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function parseSCB(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('SCB: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // First line = header; skip.
  const rows: ParsedLine[] = [];
  let accountNo = '';

  for (let i = 1; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i]);
    if (cols.length < 11) continue;

    // 0: Account Number, 1: Date, 2: Time, 3: Transaction Code, 4: Channel,
    // 5: Cheque Number, 6: Debit Amount, 7: Credit Amount, 8: Balance Sign,
    // 9: Balance Amount, 10: Description
    if (!accountNo) accountNo = cols[0].trim();

    const iso = parseSCBDate(cols[1]);
    if (!iso) continue;

    const timeRaw = cols[2]?.trim() ?? '';
    // SCB time is already HH:MM.
    const tx_time = timeRaw || undefined;

    const txn_code = cols[3]?.trim() || undefined;
    const channel = cols[4]?.trim() || undefined;
    const chequeRaw = cols[5]?.trim() ?? '';
    const cheque_no =
      chequeRaw && chequeRaw.toUpperCase() !== 'N/A' ? chequeRaw : undefined;

    const debit = parseAmount(cols[6]);
    const credit = parseAmount(cols[7]);
    const balanceSign = cols[8]?.trim() ?? '';
    let balance = parseAmount(cols[9]);
    if (balanceSign === '-') balance = -balance;

    const description = cols[10]?.trim() || '';

    rows.push({
      tx_date: iso,
      tx_time,
      txn_code,
      description,
      debit,
      credit,
      balance,
      cheque_no,
      channel,
      // Description already carries most of the useful narrative — nothing else
      // to stash in raw_remark for SCB.
    });
  }

  if (rows.length === 0) {
    throw new Error('SCB: ไม่พบรายการในไฟล์');
  }
  if (!accountNo) {
    throw new Error('SCB: ไม่พบเลขที่บัญชีในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM

  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTHS_CODE[mm] ?? mm;
  const statement_name = `SCB ${monthLabel} ${yy}`;

  return {
    bank: 'SCB',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
