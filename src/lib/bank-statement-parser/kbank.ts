// KBANK CSV statement parser.
//
// Sample layout (cp874-encoded in the wild; we assume the caller has already
// decoded to a JS string):
//
//   Line 1: รายการเดินบัญชีของวันก่อนหน้า        ← header banner
//   Line 2: ,
//   Line 3: เลขที่บัญชี,'1002820559,สกุลเงิน,THB
//   Line 4: วันที่ ตั้งแต่วันที่,01-เม.ย.-2569,ถึงวัน,30-เม.ย.-2569
//   Line 5: ชื่อบัญชี,"บจก. มาสเตอร์ คาร์เร้นเทิล"
//   Line 6: ชื่อสาขา,"..."
//   Line 7: เข้าบัญชี,257,จำนวนเงินนำฝากเข้าบัญชีทั้งหมด,40685445.45
//   Line 8: หักบัญชี,1044,จำนวนเงินที่หักบัญชีทั้งหมด,25350155.33
//   Line 9: ,
//   Line 10: วันที่ทำรายการ,เวลา,รายการ,เลขที่เช็ค,จำนวนเงินหักบัญชี,
//            จำนวนเงินนำฝากเข้าบัญชี,ยอดคงเหลือ,หมายเลข,สาขา,
//            วันที่รายการมีผล,ช่องทาง,รายละเอียด
//   Line 11+: transaction rows
//   Footer: ,  and  ** สิ้นสุดรายงาน   **
//
// Dates in the file use Thai month abbreviations + Buddhist year, e.g.
// "01-เม.ย.-2569" = 2026-04-01.

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import type { ParsedBankStatement, ParsedLine } from './types';

const THAI_MONTHS: Record<string, string> = {
  'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04',
  'พ.ค.': '05', 'มิ.ย.': '06', 'ก.ค.': '07', 'ส.ค.': '08',
  'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12',
};

/**
 * Parse a KBANK-Thai date like "01-เม.ย.-2569" → "2026-04-01".
 * Returns null on unknown month or malformed input.
 */
export function parseKBankDate(s: string): string | null {
  const trimmed = s.trim();
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const mm = THAI_MONTHS[m.trim()];
  if (!mm) return null;
  const beYear = parseInt(y.trim(), 10);
  if (!Number.isFinite(beYear)) return null;
  // Buddhist Era → Common Era (Thai BE = CE + 543)
  const ceYear = beYear - 543;
  const dd = d.trim().padStart(2, '0');
  return `${ceYear}-${mm}-${dd}`;
}

export function parseKBANK(csvText: string): ParsedBankStatement {
  const allLines = splitLines(csvText);

  // Locate the header row (the row starting with "วันที่ทำรายการ").
  const headerIdx = allLines.findIndex((l) => l.startsWith('วันที่ทำรายการ'));
  if (headerIdx === -1) {
    throw new Error('KBANK: หาแถว header ไม่เจอ (วันที่ทำรายการ...)');
  }

  // Extract account number from any prior line starting with "เลขที่บัญชี".
  let accountNo = '';
  for (let i = 0; i < headerIdx; i++) {
    const cols = splitCsvLine(allLines[i]);
    if (cols[0]?.trim() === 'เลขที่บัญชี' && cols[1] != null) {
      // The bank prefixes the account number with a single apostrophe to
      // prevent Excel from stripping leading zeros.
      accountNo = cols[1].replace(/^'/, '').trim();
      break;
    }
  }

  // Extract statement period (YYYY-MM) from the date-range row.
  let statementPeriod = '';
  for (let i = 0; i < headerIdx; i++) {
    const cols = splitCsvLine(allLines[i]);
    if (cols[0]?.trim() === 'วันที่ ตั้งแต่วันที่' && cols[1] != null) {
      const iso = parseKBankDate(cols[1]);
      if (iso) statementPeriod = iso.slice(0, 7); // YYYY-MM
      break;
    }
  }

  const lines: ParsedLine[] = [];
  for (let i = headerIdx + 1; i < allLines.length; i++) {
    const raw = allLines[i];
    if (!raw || raw.trim() === '' || raw.trim() === ',') continue;
    if (raw.includes('สิ้นสุดรายงาน')) break; // footer sentinel

    const cols = splitCsvLine(raw);
    // Expected column layout (12 fields):
    // 0: วันที่ทำรายการ, 1: เวลา, 2: รายการ, 3: เลขที่เช็ค,
    // 4: จำนวนเงินหักบัญชี, 5: จำนวนเงินนำฝากเข้าบัญชี, 6: ยอดคงเหลือ,
    // 7: หมายเลข, 8: สาขา, 9: วันที่รายการมีผล, 10: ช่องทาง, 11: รายละเอียด
    if (cols.length < 7) continue;

    const iso = parseKBankDate(cols[0]);
    if (!iso) continue;

    const timeRaw = cols[1]?.trim() ?? '';
    // Normalize HH:MM:SS → HH:MM (DB stores tx_time as text; both are fine
    // but the shorter form matches SCB and reads nicer in the preview).
    const tx_time = timeRaw ? timeRaw.slice(0, 5) : undefined;

    const txn_code = cols[2]?.trim() || undefined;
    const chequeRaw = cols[3]?.trim() ?? '';
    // KBANK uses '00000000' as "no cheque" for non-cheque rows.
    const cheque_no =
      chequeRaw && chequeRaw !== '00000000' ? chequeRaw : undefined;

    const debit = parseAmount(cols[4]);
    const credit = parseAmount(cols[5]);
    const balance = parseAmount(cols[6]);
    const channel = cols[10]?.trim() || undefined;
    const description = cols[11]?.trim() || cols[2]?.trim() || '';

    // Reference number ("หมายเลข") + branch code — stash in raw_remark so we
    // don't lose them, since bank_statement_lines has no dedicated columns.
    const refNo = cols[7]?.trim();
    const branch = cols[8]?.trim();
    const remarkParts: string[] = [];
    if (refNo) remarkParts.push(`Ref ${refNo}`);
    if (branch) remarkParts.push(`สาขา ${branch}`);
    const raw_remark = remarkParts.length ? remarkParts.join(' · ') : undefined;

    lines.push({
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

  if (lines.length === 0) {
    throw new Error('KBANK: ไม่พบรายการในไฟล์');
  }
  if (!accountNo) {
    throw new Error('KBANK: ไม่พบเลขที่บัญชีในไฟล์');
  }
  if (!statementPeriod) {
    // Fall back to min tx_date if the header row was missing.
    const minDate = lines.reduce((m, l) => (l.tx_date < m ? l.tx_date : m), lines[0].tx_date);
    statementPeriod = minDate.slice(0, 7);
  }

  // Pretty name: "KBANK <thai-month> <ce-year>"
  const [yy, mm] = statementPeriod.split('-');
  const monthLabel = Object.entries(THAI_MONTHS).find(([, code]) => code === mm)?.[0] ?? mm;
  const statement_name = `KBANK ${monthLabel} ${yy}`;

  return {
    bank: 'KBANK',
    account_no: accountNo,
    statement_period: statementPeriod,
    statement_name,
    lines,
  };
}
