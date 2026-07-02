// Multi-bank statement parser — public entry point.
//
//   const text = await decodeCP874(file);
//   const parsed = parseBankStatement(text);
//   // parsed.bank, parsed.account_no, parsed.statement_period, parsed.lines[]
//
// The importer UI dispatches on `parsed.bank` for the preview label and
// bulk-inserts into bank_statements + bank_statement_lines on confirm.

import { parseKBANK } from './kbank';
import { parseSCB } from './scb';
import type { ParsedBankStatement } from './types';

export { parseKBANK, parseKBankDate } from './kbank';
export { parseSCB, parseSCBDate } from './scb';
export type { BankCode, ParsedBankStatement, ParsedLine } from './types';

/**
 * Auto-detect bank from the file content and parse.
 *
 * Detection is by signature match against the header rows the banks ship —
 * cheaper and more forgiving than sniffing column counts.
 */
export function parseBankStatement(text: string): ParsedBankStatement {
  // KBANK banner is the first line of the file — check for the phrase anywhere
  // in the first ~200 chars to be safe against a stray BOM.
  const head = text.slice(0, 500);
  if (head.includes('รายการเดินบัญชี')) return parseKBANK(text);
  if (head.startsWith('Account Number,Date,Time')) return parseSCB(text);
  throw new Error('รู้จักเฉพาะ KBANK และ SCB · ธนาคารอื่นยังไม่รองรับ');
}

/**
 * Decode a File as cp874 (Windows-874 / TIS-620) text.
 *
 * Both KBANK and SCB export Thai statements in cp874. Modern browsers include
 * a native decoder — no polyfill needed.
 */
export async function decodeCP874(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return new TextDecoder('windows-874').decode(buf);
}
