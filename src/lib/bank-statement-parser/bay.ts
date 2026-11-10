// BAY (ธนาคารกรุงศรีอยุธยา / Krungsri) CSV statement parser — รองรับ 2 ฟอร์แมต.
//
// ── ฟอร์แมต A: ไม่มีหัวตาราง (เริ่มที่แถว B/F) · วันที่+เวลารวมคอลัมน์เดียว ──
//   "","","","6,516,382.04","B/F","ยอดเงินคงเหลือยกมา","",""
//   "05/08/2026 16:08:17","15,041.00","","6,501,341.04","TW","โอนเงิน หมายเลขอ้างอิง : 0323949425","OTHERS","0700"
//   Columns: 0 วันที่+เวลา · 1 ถอน(debit) · 2 ฝาก(credit) · 3 ยอดคงเหลือ ·
//            4 รหัส(TW/B/F) · 5 คำอธิบาย · 6 หมวด · 7 ช่องทาง
//
// ── ฟอร์แมต B: มีหัวตาราง · วันที่/เวลาแยกคอลัมน์ ──
//   วันที่,เวลา,ถอน,ฝาก,ยอดเงินในบัญชี,รหัส,คำอธิบายรายละเอียด,ช่องทาง,รหัสสาขา
//   03/09/2026,01:32:41,,"1,500,000.00","4,316,730.04",CN,เงินเข้า | หมายเลขอ้างอิง : 0000001404,ACH,0700
//   Columns map ด้วยชื่อหัวตาราง (ทนการสลับคอลัมน์)
//
// Notes:
//  - แถว B/F (ฟอร์แมต A) ไม่มีวันที่ → parseBAYDate คืน null → ข้ามเอง.
//  - คำอธิบายมีเลขอ้างอิง ("หมายเลขอ้างอิง : <เลข>") → auto-link ผ่าน extractTTBRef ได้.
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

  // หาแถวหัวตาราง (ฟอร์แมต B) — ต้องมี 'ยอดเงินในบัญชี' + ('ถอน' หรือ 'ฝาก')
  let hr = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(allLines.length, 4); i++) {
    const cols = splitCsvLine(allLines[i].replace(/^﻿/, '')).map((c) => c.trim());
    if (cols.includes('ยอดเงินในบัญชี') && (cols.includes('ถอน') || cols.includes('ฝาก'))) {
      hr = i;
      headers = cols;
      break;
    }
  }

  const rows: ParsedLine[] = [];

  if (hr >= 0) {
    // ── ฟอร์แมต B: map ด้วยชื่อหัวตาราง · วันที่/เวลาแยกคอลัมน์ ──
    const col = (name: string) => headers.findIndex((h) => h === name);
    const iDate = col('วันที่');
    const iTime = col('เวลา');
    const iDr = col('ถอน');
    const iCr = col('ฝาก');
    const iBal = col('ยอดเงินในบัญชี');
    const iCode = col('รหัส');
    const iDesc = headers.findIndex((h) => h.includes('คำอธิบาย'));
    const iChan = col('ช่องทาง');
    const iBranch = col('รหัสสาขา');
    if ([iDate, iDr, iCr, iBal].some((x) => x < 0)) {
      throw new Error(HEADER_NOT_FOUND);
    }
    for (let i = hr + 1; i < allLines.length; i++) {
      const cols = splitCsvLine(allLines[i].replace(/^﻿/, ''));
      const parsed = parseBAYDate(cols[iDate] ?? '');
      if (!parsed) continue;
      const timeRaw = iTime >= 0 ? (cols[iTime] ?? '').trim() : '';
      rows.push({
        tx_date: parsed.iso,
        tx_time: (timeRaw ? timeRaw.slice(0, 5) : parsed.time) || undefined,
        txn_code: iCode >= 0 ? (cols[iCode] ?? '').trim() || undefined : undefined,
        description: iDesc >= 0 ? (cols[iDesc] ?? '').trim() : '',
        debit: parseAmount(cols[iDr]),
        credit: parseAmount(cols[iCr]),
        balance: parseAmount(cols[iBal]),
        channel: iChan >= 0 ? (cols[iChan] ?? '').trim() || undefined : undefined,
        raw_remark: iBranch >= 0 ? (cols[iBranch] ?? '').trim() || undefined : undefined,
      });
    }
  } else {
    // ── ฟอร์แมต A: ไม่มีหัวตาราง เริ่มที่ B/F · วันที่+เวลารวมคอลัมน์เดียว ──
    for (const line of allLines) {
      const cols = splitCsvLine(line.replace(/^﻿/, ''));
      if (cols.length < 4) continue;

      const parsed = parseBAYDate(cols[0] ?? '');
      if (!parsed) continue; // ข้าม B/F และแถวที่ไม่มีวันที่

      rows.push({
        tx_date: parsed.iso,
        tx_time: parsed.time,
        txn_code: (cols[4] ?? '').trim() || undefined,
        description: (cols[5] ?? '').trim(),
        debit: parseAmount(cols[1]),
        credit: parseAmount(cols[2]),
        balance: parseAmount(cols[3]),
        channel: (cols[7] ?? '').trim() || undefined,
        raw_remark: (cols[6] ?? '').trim() || undefined, // หมวด
      });
    }
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
