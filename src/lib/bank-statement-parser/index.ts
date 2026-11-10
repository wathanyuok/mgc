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
import { parseTTB } from './ttb';
import { parseMizuho } from './mizuho';
import { parseBBLiBanking } from './bbl-ibanking';
import { parseKTB } from './ktb';
import { parseBAY } from './bay';
import { parseBBLTxnReport } from './bbl-txn-report';
import { HEADER_NOT_FOUND, type ParsedBankStatement } from './types';

export { parseKBANK, parseKBankDate } from './kbank';
export { parseSCB, parseSCBDate } from './scb';
export { parseBBL, parseBBLDate } from './bbl';
export { parseTTB, parseTTBDate } from './ttb';
export { parseMizuho, parseMizuhoDate } from './mizuho';
export { parseBBLiBanking, parseBBLibDate } from './bbl-ibanking';
export { parseKTB, parseKTBDate } from './ktb';
export { parseBAY, parseBAYDate } from './bay';
export { parseBBLTxnReport, parseBBLTxnDate } from './bbl-txn-report';
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
  if (head.includes('Transaction Date And Time')) return parseBBLTxnReport(text);
  if (head.includes('วันที่ทำรายการ,วันที่มีผล')) return parseTTB(text);
  if (head.includes('Booking_Date')) return parseMizuho(text);
  if (head.includes('หักบัญชี|เข้าบัญชี')) return parseBBLiBanking(text);
  if (head.includes('Withdrawal_THB,Deposit_THB')) return parseKTB(text);
  if (head.includes('ยอดเงินคงเหลือยกมา')) return parseBAY(text);
  if (head.includes('ถอน,ฝาก,ยอดเงินในบัญชี')) return parseBAY(text);
  throw new Error(HEADER_NOT_FOUND);
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
/**
 * รายชื่อ sheet ใน .xls/.xlsx — ให้หน้า import โชว์ dropdown เลือก sheet
 * (ไฟล์เดียวอาจมีหลายบัญชี sheet ละบัญชี) · ไฟล์ที่ไม่ใช่ Excel คืน [] (อ่าน sheet เดียว).
 */
export async function listBankFileSheets(file: File): Promise<string[]> {
  const name = (file.name ?? '').toLowerCase();
  if (!/\.(xls|xlsx)$/.test(name)) return [];
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
  return wb.SheetNames ?? [];
}

export async function readBankFile(file: File, sheetName?: string): Promise<string> {
  const name = (file.name ?? '').toLowerCase();

  // รองรับเฉพาะ .csv / .xls / .xlsx — นามสกุลอื่นแจ้งเตือนทันที (ไม่พยายามอ่าน)
  if (!/\.(csv|xls|xlsx)$/.test(name)) {
    throw new Error('ระบบรองรับเฉพาะไฟล์ .csv / .xls / .xlsx');
  }

  const buf = await file.arrayBuffer();

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    // cellDates: true → เซลล์ที่ Excel แปลงเป็นวันที่จะเป็น Date object (ไม่ใช่ serial number)
    // dateNF: 'yyyy-mm-dd' → sheet_to_csv พิมพ์วันเป็น ISO ให้ parser อ่านได้
    // (ไม่งั้นไฟล์ที่เปิด/เซฟผ่าน Excel จะได้ serial เช่น 46234 → parser อ่านวันไม่ออก → 0 รายการ)
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    // เลือก sheet ตามชื่อที่ส่งมา (ไฟล์หลายบัญชี) — ไม่ส่งมา = sheet แรก
    const pick = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
    const ws = wb.Sheets[pick];
    if (!ws) throw new Error('ไฟล์ Excel ไม่มีชีตข้อมูล');
    return XLSX.utils.sheet_to_csv(ws, { dateNF: 'yyyy-mm-dd' });
  }

  // UTF-8 BOM (EF BB BF) = ไฟล์เป็น UTF-8 แน่ (เช่น KTB) — decode utf-8 ก่อน
  // ไม่งั้น cp874 จะ match signature ASCII ได้ แล้ว BOM เพี้ยนเป็น "๏ปฟ" ติดหัวตาราง
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const utf8Bom = new TextDecoder('utf-8').decode(buf); // ตัด BOM ให้เอง
    if (hasBankSignature(utf8Bom)) return utf8Bom;
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
    head.includes('ACCOUNT ACTIVITY HISTORY REPORT') ||
    head.includes('Transaction Date And Time') ||
    head.includes('วันที่ทำรายการ,วันที่มีผล') ||
    head.includes('Booking_Date') ||
    head.includes('หักบัญชี|เข้าบัญชี') ||
    head.includes('Withdrawal_THB,Deposit_THB') ||
    head.includes('ยอดเงินคงเหลือยกมา') ||
    head.includes('ถอน,ฝาก,ยอดเงินในบัญชี')
  );
}
