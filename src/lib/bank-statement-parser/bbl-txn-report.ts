// BBL "Transaction Report" statement parser (คนละฟอร์แมตกับ bbl.ts ที่เป็น
// "ACCOUNT ACTIVITY HISTORY REPORT" และ bbl-ibanking.ts ที่เป็น pipe CSV).
//
// Export จาก BBL iCash (Corporate) แบบ .xlsx — readBankFile แปลงเป็น CSV ก่อน:
//
//   Transaction Report
//   (Period from 01/10/2026 to 30/10/2026)
//   Customer,บจ. ...,,Bank,BANGKOK BANK ...,,,Cash Balance,8,402,367.49
//   Account Number,2004XXX017,,Source Of Account,Internal,...
//   ...
//   Transaction Date And Time,Value Date,Description,Cheque No.,Debit,Credit,Ledger Balance,Channel,Branch
//   02/10/2026 04:01:26,02/10/2026,BBL.CARD,,,325,781.53,8,517,113.54,Automatic,HEAD OFFICE
//
// Notes:
//  - วันที่ "02/10/2026 04:01:26" เป็น ค.ศ. (dd/MM/yyyy + เวลา).
//  - Debit = เงินออก · Credit = เงินเข้า · Ledger Balance = ยอดคงเหลือ (ติดลบได้ = OD).
//  - เลขบัญชีในไฟล์ถูกปิดบัง (เช่น 2004XXX017) — คืนมาตามที่มี ผู้ใช้แก้ในฟอร์มได้.
//  - map คอลัมน์ด้วยชื่อหัวตาราง (ทนการสลับคอลัมน์).

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTH_LABEL: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "02/10/2026 04:01:26" → { iso:'2026-10-02', time:'04:01' }. รองรับ ISO ด้วย. */
export function parseBBLTxnDate(s: string): { iso: string; time?: string } | null {
  const t = s.trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, time: iso[4] };
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, hh, mi] = m;
  return {
    iso: `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
    time: hh && mi ? `${hh.padStart(2, '0')}:${mi}` : undefined,
  };
}

export function parseBBLTxnReport(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('BBL: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หาแถวหัวตาราง + เลขบัญชี (อยู่ก่อนหัวตาราง)
  let hr = -1;
  let headers: string[] = [];
  let accountNo = '';
  for (let i = 0; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i].replace(/^﻿/, '')).map((c) => c.trim());
    if (!accountNo) {
      const ai = cols.findIndex((c) => c === 'Account Number');
      if (ai >= 0 && cols[ai + 1]) accountNo = cols[ai + 1].trim();
    }
    if (cols.includes('Transaction Date And Time') && cols.includes('Ledger Balance')) {
      hr = i;
      headers = cols;
      break;
    }
  }
  if (hr < 0) throw new Error(HEADER_NOT_FOUND);

  const col = (name: string) => headers.findIndex((h) => h === name);
  const iDate = col('Transaction Date And Time');
  const iDesc = col('Description');
  const iCheque = col('Cheque No.');
  const iDr = col('Debit');
  const iCr = col('Credit');
  const iBal = col('Ledger Balance');
  const iChan = col('Channel');
  const iBranch = col('Branch');
  if ([iDate, iDr, iCr, iBal].some((x) => x < 0)) {
    throw new Error(HEADER_NOT_FOUND);
  }

  const rows: ParsedLine[] = [];
  for (let i = hr + 1; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i].replace(/^﻿/, ''));
    const parsed = parseBBLTxnDate(cols[iDate] ?? '');
    if (!parsed) continue;

    const chequeRaw = iCheque >= 0 ? (cols[iCheque] ?? '').trim() : '';
    const cheque_no = chequeRaw && !/^0+$/.test(chequeRaw) ? chequeRaw : undefined;
    const branch = iBranch >= 0 ? (cols[iBranch] ?? '').trim() : '';

    rows.push({
      tx_date: parsed.iso,
      tx_time: parsed.time,
      description: iDesc >= 0 ? (cols[iDesc] ?? '').trim() : '',
      // ฟอร์แมตนี้เขียน Debit เป็นค่าติดลบ (เงินออก) — เก็บเป็น magnitude บวกตามสัญญา ParsedLine
      debit: Math.abs(parseAmount(cols[iDr])),
      credit: Math.abs(parseAmount(cols[iCr])),
      balance: parseAmount(cols[iBal]), // ยอดคงเหลือคงเครื่องหมายไว้ (ติดลบ = OD)
      cheque_no,
      channel: iChan >= 0 ? (cols[iChan] ?? '').trim() || undefined : undefined,
      raw_remark: branch ? `สาขา ${branch}` : undefined,
    });
  }

  if (rows.length === 0) {
    throw new Error('BBL: ไม่พบรายการในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTH_LABEL[mm] ?? mm;
  const statement_name = `BBL ${monthLabel} ${yy}`;

  return {
    bank: 'BBL',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
