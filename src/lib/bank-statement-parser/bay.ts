// BAY (ธนาคารกรุงศรีอยุธยา / Krungsri) CSV statement parser.
//
// Export แบบ comma-delimited · ทุกฟิลด์ครอบ "…" · UTF-8 (BOM) · ไม่มีแถวหัวตาราง
// (เริ่มที่แถว B/F ยอดยกมาเลย) · วันที่ dd/MM/yyyy (ค.ศ.):
//
//   "","","","6,516,382.04","B/F","ยอดเงินคงเหลือยกมา","",""
//   "05/08/2026 16:08:17","15,041.00","","6,501,341.04","TW","โอนเงิน หมายเลขอ้างอิง : 0323949425","OTHERS","0700"
//
// Columns (fixed position — ไม่มี header):
//   0: วันที่+เวลา · 1: ถอน(debit) · 2: ฝาก(credit) · 3: ยอดคงเหลือ ·
//   4: รหัส(TW/B/F) · 5: คำอธิบาย (มี "หมายเลขอ้างอิง : <เลข>") · 6: หมวด · 7: ช่องทาง
//
// Notes:
//  - แถว B/F ไม่มีวันที่ → parseBAYDate คืน null → ข้ามเอง (เป็นยอดยกมา ไม่ใช่ธุรกรรม).
//  - คำอธิบายมีเลขอ้างอิง → auto-link ผ่าน extractTTBRef ได้.
//  - ไฟล์ไม่มีคอลัมน์เลขบัญชี — คืน account_no ว่าง (เลขอยู่ในชื่อไฟล์).

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

const THAI_MONTH_LABEL: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.',
};

/** Parse "05/08/2026 16:08:17" → { iso:'2026-08-05', time:'16:08' }. รองรับ ISO ด้วย. */
export function parseBAYDate(s: string): { iso: string; time?: string } | null {
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

export function parseBAY(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText).filter((l) => l.trim() !== '');
  if (allLines.length < 1) {
    throw new Error('BAY: ไฟล์ว่างหรือไม่มีรายการ');
  }

  const rows: ParsedLine[] = [];
  for (const line of allLines) {
    const cols = splitCsvLine(line.replace(/^﻿/, ''));
    if (cols.length < 4) continue;

    const parsed = parseBAYDate(cols[0] ?? '');
    if (!parsed) continue; // ข้าม B/F และแถวที่ไม่มีวันที่

    const debit = parseAmount(cols[1]);
    const credit = parseAmount(cols[2]);
    const balance = parseAmount(cols[3]);
    const txn_code = (cols[4] ?? '').trim() || undefined;
    const description = (cols[5] ?? '').trim();
    const channel = (cols[7] ?? '').trim() || undefined;
    // หมวด (col 6) เก็บไว้ใน raw_remark
    const category = (cols[6] ?? '').trim();

    rows.push({
      tx_date: parsed.iso,
      tx_time: parsed.time,
      txn_code,
      description,
      debit,
      credit,
      balance,
      channel,
      raw_remark: category || undefined,
    });
  }

  if (rows.length === 0) {
    throw new Error('BAY: ไม่พบรายการในไฟล์');
  }

  const minDate = rows.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), rows[0].tx_date);
  const statementPeriod = minDate.slice(0, 7); // YYYY-MM
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = THAI_MONTH_LABEL[mm] ?? mm;
  const statement_name = `BAY ${monthLabel} ${yy}`;

  return {
    bank: 'BAY',
    account_no: '', // ไฟล์ไม่มีคอลัมน์เลขบัญชี — ผู้ใช้กรอกในฟอร์ม
    statement_period: statementPeriod,
    statement_name,
    lines: rows,
  };
}
