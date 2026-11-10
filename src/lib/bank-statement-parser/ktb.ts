// KTB (ธนาคารกรุงไทย) CSV statement parser.
//
// Export แบบ comma-delimited · UTF-8 (BOM) · วันที่เป็น ISO (ค.ศ. อยู่แล้ว):
//
//   Date,Time,Transaction,Withdrawal_THB,Deposit_THB,Balance_THB,Details
//   2026-08-05,13:13,Deposit (SDTRC),,1000000.00,1000000.00,
//   2026-08-26,16:30,Withdrawal (SWOTT),5020.00,,994980.00,
//
// Notes:
//  - Date เป็น ISO yyyy-MM-dd (รองรับ dd/MM/yyyy ด้วยเผื่อฟอร์แมตอื่น).
//  - Withdrawal_THB = debit · Deposit_THB = credit · Balance_THB = balance.
//  - Transaction = "ประเภท (รหัส)" เช่น 'Deposit (SDTRC)' → เก็บรหัสใน parens เป็น txn_code.
//  - ไฟล์ไม่มีคอลัมน์ "เลขที่บัญชี" — คืน account_no ว่าง ให้ผู้ใช้กรอกในฟอร์ม
//    (เลขบัญชีอยู่ในชื่อไฟล์ เช่น 189-0-81402-4).
//  - map คอลัมน์ด้วย "ชื่อหัวตาราง" — ทนการสลับคอลัมน์.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

// KTB export เป็น UTF-8 (BOM) แต่ readBankFile decode cp874 ก่อน (signature เป็น
// ASCII เลยตรงใน cp874) ทำให้ BOM UTF-8 (EF BB BF) กลายเป็น "ï»¿" ติดหน้า — strip ทั้งสองแบบ
const stripBom = (s: string) => s.replace(/^(?:﻿|ï»¿)/, '');

const THAI_MONTH_LABEL: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "2026-08-05" (ISO) → "2026-08-05". รองรับ dd/MM/yyyy ด้วย. */
export function parseKTBDate(s: string): string | null {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = t.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const yy = parseInt(y, 10);
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function parseKTB(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('KTB: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หาแถวหัวตาราง (map ด้วยชื่อคอลัมน์ — ทนการสลับคอลัมน์)
  let hr = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(allLines.length, 6); i++) {
    const cols = splitCsvLine(stripBom(allLines[i])).map((c) => c.trim());
    if (cols.includes('Date') && cols.includes('Withdrawal_THB') && cols.includes('Deposit_THB')) {
      hr = i;
      headers = cols;
      break;
    }
  }
  if (hr < 0) throw new Error(HEADER_NOT_FOUND);

  const col = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iDate = col('Date');
  const iTime = col('Time');
  const iTxn = col('Transaction');
  const iDr = col('Withdrawal_THB');
  const iCr = col('Deposit_THB');
  const iBal = col('Balance_THB');
  const iDetails = col('Details');
  if ([iDate, iDr, iCr, iBal].some((x) => x < 0)) {
    throw new Error(HEADER_NOT_FOUND);
  }

  const rows: ParsedLine[] = [];
  for (let i = hr + 1; i < allLines.length; i++) {
    const cols = splitCsvLine(stripBom(allLines[i]));
    const iso = parseKTBDate(cols[iDate] ?? '');
    if (!iso) continue;

    const transaction = iTxn >= 0 ? (cols[iTxn] ?? '').trim() : '';
    // รหัสในวงเล็บ เช่น 'Deposit (SDTRC)' → 'SDTRC'
    const codeMatch = transaction.match(/\(([^)]+)\)\s*$/);
    const txn_code = codeMatch ? codeMatch[1].trim() : undefined;

    const debit = parseAmount(cols[iDr]);
    const credit = parseAmount(cols[iCr]);
    const balance = parseAmount(cols[iBal]);
    const details = iDetails >= 0 ? (cols[iDetails] ?? '').trim() : '';

    rows.push({
      tx_date: iso,
      tx_time: iTime >= 0 ? (cols[iTime] ?? '').trim() || undefined : undefined,
      txn_code,
      description: transaction,
      debit,
      credit,
      balance,
      raw_remark: details || undefined,
    });
  }

  if (rows.length === 0) {
    throw new Error('KTB: ไม่พบรายการในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTH_LABEL[mm] ?? mm;
  const statement_name = `KTB ${monthLabel} ${yy}`;

  return {
    bank: 'KTB',
    account_no: '', // ไฟล์ไม่มีคอลัมน์เลขบัญชี — ผู้ใช้กรอกในฟอร์ม
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
