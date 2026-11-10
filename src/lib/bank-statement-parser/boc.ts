// BOC (Bank of China (Thai)) CSV statement parser.
//
// Export แบบ comma-delimited · UTF-8 (BOM) · วันที่ ISO (ค.ศ.) · มีหัวตาราง:
//
//   Bank,Company,Account Number,Account Type,Currency,Transaction Date,Value Date,Description,Withdrawal (THB),Deposit (THB),Balance (THB)
//   Bank of China (Thai),"MILLENNIUM AUTO GROUP CO.,LTD.",100000301414850,Corp THB Saving (PB),THB,2026-07-06,2026-07-06,"Loan Repayment ...",44531.50,,4494521.39
//
// Notes:
//  - Transaction Date เป็น ISO yyyy-MM-dd (รองรับ dd/MM/yyyy ด้วยเผื่อฟอร์แมตอื่น).
//  - Withdrawal (THB) = debit · Deposit (THB) = credit · Balance (THB) = balance.
//  - Description มีเลขอ้างอิง (เช่น 'CQNO: BBL02810781') → auto-link ผ่าน extractTTBRef ได้.
//  - Description อาจมี comma อยู่ในเครื่องหมายคำพูด → ใช้ splitCsvLine จัดการ.
//  - map คอลัมน์ด้วยชื่อหัวตาราง (ทนการสลับคอลัมน์).

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTH_LABEL: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "2026-07-06" (ISO) → "2026-07-06". รองรับ dd/MM/yyyy ด้วย. */
export function parseBOCDate(s: string): string | null {
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

export function parseBOC(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('BOC: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หาแถวหัวตาราง (map ด้วยชื่อคอลัมน์ — ทนการสลับคอลัมน์)
  let hr = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(allLines.length, 6); i++) {
    const cols = splitCsvLine(allLines[i].replace(/^﻿/, '')).map((c) => c.trim());
    if (cols.includes('Transaction Date') && cols.includes('Balance (THB)')) {
      hr = i;
      headers = cols;
      break;
    }
  }
  if (hr < 0) throw new Error(HEADER_NOT_FOUND);

  const col = (name: string) => headers.findIndex((h) => h === name);
  const iAcc = col('Account Number');
  const iDate = col('Transaction Date');
  const iDesc = col('Description');
  const iDr = col('Withdrawal (THB)');
  const iCr = col('Deposit (THB)');
  const iBal = col('Balance (THB)');
  if ([iDate, iDr, iCr, iBal].some((x) => x < 0)) {
    throw new Error(HEADER_NOT_FOUND);
  }

  const rows: ParsedLine[] = [];
  let accountNo = '';
  for (let i = hr + 1; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i].replace(/^﻿/, ''));
    const iso = parseBOCDate(cols[iDate] ?? '');
    if (!iso) continue;

    if (!accountNo && iAcc >= 0) accountNo = (cols[iAcc] ?? '').trim();

    // Description อาจมีขึ้นบรรทัดใหม่ในตัว — ยุบ newline เป็นช่องว่าง
    const description = (iDesc >= 0 ? cols[iDesc] ?? '' : '').replace(/\s*\n\s*/g, ' ').trim();

    rows.push({
      tx_date: iso,
      description,
      debit: parseAmount(cols[iDr]),
      credit: parseAmount(cols[iCr]),
      balance: parseAmount(cols[iBal]),
    });
  }

  if (rows.length === 0) {
    throw new Error('BOC: ไม่พบรายการในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTH_LABEL[mm] ?? mm;
  const statement_name = `BOC ${monthLabel} ${yy}`;

  return {
    bank: 'BOC',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
