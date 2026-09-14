// BBL (Bangkok Bank) statement parser — "ACCOUNT ACTIVITY HISTORY REPORT".
//
// BBL exports this report as .xls (Excel). The file-reading layer converts it
// to CSV text first (via SheetJS `sheet_to_csv`), so this parser works on the
// same text shape as the KBANK / SCB parsers.
//
// Sample layout (after xls → csv conversion — note the many empty spacer
// columns BBL leaves between fields):
//
//   Row: (blank)
//   Row: ,,,,,ACCOUNT ACTIVITY HISTORY REPORT          ← signature banner
//   Row: ,,,,,,From(01/05/2026)-To(31/05/2026)         ← statement period
//   Row: ,,,,,,Account Number:2003033574               ← account number
//   Row: (blank)
//   Row: Tran Date,,Value Date,,Description,,,Tran Code,,Cheque No.,,Debit,,
//        Credit,,,Balance,,,Channel,,Terminal Id,,Branch,,...   ← column header
//   Row: (blank)
//   Row+: transaction rows
//
// Fixed column positions (0-based, after CSV split):
//   [0] Tran Date · [2] Value Date · [4] Description · [7] Tran Code ·
//   [9] Cheque No. · [11] Debit · [13] Credit · [16] Balance ·
//   [19] Channel · [21] Terminal Id · [23] Branch
//
// Dates are dd/MM/yyyy with CE year (e.g. "07/05/2026" = 2026-05-07) —
// unlike KBANK which uses Thai month abbreviations + Buddhist year.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import type { ParsedBankStatement, ParsedLine } from './types';

const THAI_MONTHS_CODE: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "07/05/2026" → "2026-05-07" (dd/MM/yyyy, CE year). */
export function parseBBLDate(s: string): string | null {
  const m = (s ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseBBL(csvText: string): ParsedBankStatement {
  const lines = splitLines(csvText);

  let accountNo = '';
  let period = '';        // 'YYYY-MM' from the "From(..)" banner, if present
  let started = false;    // flips true once we pass the "Tran Date" column header
  const rows: ParsedLine[] = [];

  for (const line of lines) {
    // Header banners (appear before the transaction table)
    if (!accountNo) {
      const m = line.match(/Account Number:\s*([0-9]+)/);
      if (m) accountNo = m[1];
    }
    if (!period) {
      const m = line.match(/From\((\d{2})\/(\d{2})\/(\d{4})\)/);
      if (m) period = `${m[3]}-${m[2]}`; // YYYY-MM
    }

    const cols = splitCsvLine(line);

    if (!started) {
      // The column-header row starts with "Tran Date" in the first cell.
      if (cols[0]?.trim() === 'Tran Date') started = true;
      continue;
    }

    const iso = parseBBLDate(cols[0] ?? '');
    if (!iso) continue; // skip blank / footer rows

    const txn_code = cols[7]?.trim() || undefined;
    const chequeRaw = cols[9]?.trim() ?? '';
    // BBL uses "00000000" as the placeholder for "no cheque".
    const cheque_no = chequeRaw && chequeRaw !== '00000000' ? chequeRaw : undefined;

    const debit = parseAmount(cols[11]);
    const credit = parseAmount(cols[13]);
    const balance = parseAmount(cols[16]); // signed already (can be negative)

    const channel = cols[19]?.trim() || undefined;
    const description = cols[4]?.trim() || '';

    // Extra BBL-only fields → stash in raw_remark (packed into DB `remark`).
    const terminal = cols[21]?.trim();
    const branch = cols[23]?.trim();
    const remarkParts = [
      terminal ? `Terminal ${terminal}` : null,
      branch ? `สาขา ${branch}` : null,
    ].filter(Boolean) as string[];
    const raw_remark = remarkParts.length ? remarkParts.join(' · ') : undefined;

    rows.push({
      tx_date: iso,
      // BBL report has no time column — tx_time left undefined.
      txn_code,
      description,
      debit,
      credit,
      balance,
      cheque_no,
      channel,
      raw_remark,
    });
  }

  if (!accountNo) {
    throw new Error('BBL: ไม่พบเลขที่บัญชีในไฟล์');
  }
  if (rows.length === 0) {
    throw new Error('BBL: ไม่พบรายการในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statement_period = period || minDate.slice(0, 7); // YYYY-MM

  const [yy, mm] = statement_period.split('-');
  const monthLabel = THAI_MONTHS_CODE[mm] ?? mm;
  const statement_name = `BBL ${monthLabel} ${yy}`;

  return {
    bank: 'BBL',
    account_no: accountNo,
    statement_period,
    statement_name,
    lines: rows,
  };
}
