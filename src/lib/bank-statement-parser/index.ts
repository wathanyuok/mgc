// Multi-bank statement parser — public entry point.
//
//   const text = await readBankFile(file);      // handles .csv and .xls
//   const parsed = parseBankStatement(text);
//   // parsed.bank, parsed.account_no, parsed.statement_period, parsed.lines[]
//
// The importer UI dispatches on `parsed.bank` for the preview label and
// bulk-inserts into bank_statements + bank_statement_lines on confirm.

import * as XLSX from 'xlsx';
import { parseKBANK } from './kbank';
import { parseSCB } from './scb';
import { parseBBL } from './bbl';
import type { ParsedBankStatement } from './types';

export { parseKBANK, parseKBankDate } from './kbank';
export { parseSCB, parseSCBDate } from './scb';
export { parseBBL, parseBBLDate } from './bbl';
export type { BankCode, ParsedBankStatement, ParsedLine } from './types';

/**
 * Auto-detect bank from the file content and parse.
 *
 * Detection is by signature match against the header rows the banks ship —
 * cheaper and more forgiving than sniffing column counts.
 */
export function parseBankStatement(text: string): ParsedBankStatement {
  // Signature match against the first chunk — tolerant of a stray BOM / blank
  // leading rows (BBL's xls→csv output starts with a few empty comma rows).
  const head = text.slice(0, 800);
  if (head.includes('รายการเดินบัญชี')) return parseKBANK(text);
  if (head.startsWith('Account Number,Date,Time')) return parseSCB(text);
  if (head.includes('ACCOUNT ACTIVITY HISTORY REPORT')) return parseBBL(text);
  throw new Error('รู้จักเฉพาะ KBANK, SCB และ BBL · ธนาคารอื่นยังไม่รองรับ');
}

/**
 * Decode a File as cp874 (Windows-874 / TIS-620) text.
 *
 * KBANK and SCB export Thai statements as cp874 CSV. Modern browsers include a
 * native decoder — no polyfill needed.
 */
export async function decodeCP874(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return new TextDecoder('windows-874').decode(buf);
}

/**
 * Read an uploaded statement file into CSV text — accepts BOTH .csv and .xls.
 *
 *  • .xls / .xlsx  → parsed with SheetJS, first sheet flattened to CSV text.
 *  • anything else → treated as cp874-encoded CSV (KBANK / SCB native export).
 *
 * The bank parsers all work on CSV text, so this is the single entry point the
 * importer should call before `parseBankStatement`.
 */
export async function readBankFile(file: File): Promise<string> {
  const name = (file.name ?? '').toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('ไฟล์ Excel ไม่มีชีตข้อมูล');
    return XLSX.utils.sheet_to_csv(ws);
  }

  // CSV/TXT: KBANK & SCB export cp874 (Thai). Some exports may be UTF-8 —
  // fall back to UTF-8 when no known bank signature is found in the cp874 text.
  const cp874 = new TextDecoder('windows-874').decode(buf);
  if (hasBankSignature(cp874)) return cp874;
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (hasBankSignature(utf8)) return utf8;
  // No signature either way — return cp874 and let parseBankStatement raise a
  // clear "unsupported bank" error.
  return cp874;
}

/** True when the text head carries a known bank's signature banner. */
function hasBankSignature(text: string): boolean {
  const head = text.slice(0, 800);
  return (
    head.includes('รายการเดินบัญชี') ||
    head.startsWith('Account Number,Date,Time') ||
    head.includes('ACCOUNT ACTIVITY HISTORY REPORT')
  );
}
