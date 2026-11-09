// TTB (ttb bank) CSV statement parser.
//
// Sample layout (UTF-8 with BOM · Thai headers):
//
//   Header:
//     เลขที่บัญชี,วันที่ทำรายการ,วันที่มีผล,รหัสประเภทรายการ,เลขที่เช็ค,ถอน,ฝาก,
//     ยอดคงเหลือ,ช่องทางทำรายการ,รายละเอียดการทำธุรกรรม,บริษัท,เวลา,สกุลเงิน,ช่องทาง,
//     รายละเอียดเพิ่มเติม,Cross Reference No.,Additional 1..6
//   Row:
//     9142000547,05/08/2026,05/08/2026,AD,,26959.00,0.00,3112796.13,001AL,
//     Auto Payment to Auto lending,บจก. มาสเตอร์ คาร์เร้นเทิล,15:37,THB,Auto,,,…
//
// Notes on the format:
//  - Date is already CE — dd/MM/yyyy.
//  - ถอน = debit (money out) · ฝาก = credit (money in) · ยอดคงเหลือ = balance.
//  - No separate "balance sign" column — balance is a plain signed number.
//  - เวลา is HH:MM (24h). รหัสประเภทรายการ is a short code e.g. 'AD'.
//  - Company + extra reference columns are packed into raw_remark so the raw
//    source stays traceable.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTHS_CODE: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "05/08/2026" → "2026-08-05" (CE already).
 *  รองรับ ISO "2026-08-05" / "2026-08-05 00:00:00" ด้วย — กรณีไฟล์ .xlsx ที่ Excel แปลงวันเป็น date cell */
export function parseTTBDate(s: string): string | null {
  const trimmed = s.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = trimmed.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const yy = parseInt(y, 10);
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function parseTTB(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 2) {
    throw new Error('TTB: ไฟล์ว่างหรือไม่มีรายการ');
  }

  // หัวตารางต้องครบคอลัมน์หลัก — กันไฟล์ที่ถูกแก้จนหัวตารางไม่ครบ (FR-MST-BS-013)
  {
    const hdr = allLines[0].replace(/^﻿/, '');
    const NEED = ['เลขที่บัญชี', 'วันที่ทำรายการ', 'รหัสประเภทรายการ', 'ถอน', 'ฝาก',
      'ยอดคงเหลือ', 'รายละเอียดการทำธุรกรรม'];
    if (NEED.some((k) => !hdr.includes(k))) {
      throw new Error(HEADER_NOT_FOUND);
    }
  }

  const rows: ParsedLine[] = [];
  let accountNo = '';

  for (let i = 1; i < allLines.length; i++) {
    const cols = splitCsvLine(allLines[i]);
    if (cols.length < 10) continue;

    // 0: เลขที่บัญชี · 1: วันที่ทำรายการ · 2: วันที่มีผล · 3: รหัสประเภทรายการ ·
    // 4: เลขที่เช็ค · 5: ถอน · 6: ฝาก · 7: ยอดคงเหลือ · 8: ช่องทางทำรายการ ·
    // 9: รายละเอียดการทำธุรกรรม · 10: บริษัท · 11: เวลา · 12: สกุลเงิน · 13: ช่องทาง ·
    // 14: รายละเอียดเพิ่มเติม · 15: Cross Reference No. · 16-21: Additional 1-6
    if (!accountNo) accountNo = cols[0].trim();

    const iso = parseTTBDate(cols[1]);
    if (!iso) continue;

    const tx_time = cols[11]?.trim() || undefined;
    const txn_code = cols[3]?.trim() || undefined;
    const channel = cols[13]?.trim() || cols[8]?.trim() || undefined;
    const chequeRaw = cols[4]?.trim() ?? '';
    const cheque_no = chequeRaw && chequeRaw.toUpperCase() !== 'N/A' ? chequeRaw : undefined;

    const debit = parseAmount(cols[5]);
    const credit = parseAmount(cols[6]);
    const balance = parseAmount(cols[7]);

    const description = cols[9]?.trim() || '';

    // เก็บข้อมูลอ้างอิงที่เหลือไว้ใน raw_remark — บริษัท · รายละเอียดเพิ่มเติม ·
    // Cross Reference · Additional 1-6 · รหัสช่องทาง (เผื่อใช้ match/ตรวจย้อนหลัง)
    const extras = [
      cols[10], // บริษัท
      cols[14], // รายละเอียดเพิ่มเติม
      cols[15], // Cross Reference No.
      ...cols.slice(16, 22), // Additional 1-6
      cols[8], // ช่องทางทำรายการ (รหัส เช่น 001AL)
    ]
      .map((c) => (c ?? '').trim())
      .filter(Boolean);
    const raw_remark = extras.length ? extras.join(' · ') : undefined;

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
      raw_remark,
    });
  }

  if (rows.length === 0) {
    throw new Error('TTB: ไม่พบรายการในไฟล์');
  }
  if (!accountNo) {
    throw new Error('TTB: ไม่พบเลขที่บัญชีในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM

  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTHS_CODE[mm] ?? mm;
  const statement_name = `TTB ${monthLabel} ${yy}`;

  return {
    bank: 'TTB',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
