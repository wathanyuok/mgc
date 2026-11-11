// ฟอร์แมตกลาง (Generic / MGC template) — สำหรับให้ user กรอกเองแล้ว import
//
// ต่างจาก parser ของธนาคาร: จับคอลัมน์จาก "ชื่อหัวตาราง" (ไม่ใช่ตำแหน่ง)
//   → คอลัมน์สลับที่ได้ · มีคอลัมน์เกินมา (ชื่ออื่น) ระบบข้ามให้ ไม่ error
//
// คอลัมน์ที่ระบบใช้ (หัวตาราง — ตัวพิมพ์เล็ก/ใหญ่ไม่เกี่ยง):
//   Account Number* · Date* · Time · Transaction Code · Debit · Credit · Balance* · Description
//   * = จำเป็น (ต้องมีหัวคอลัมน์) · Debit/Credit กรอกอย่างใดอย่างหนึ่งต่อแถว
//   Balance ใส่เครื่องหมายลบติดกับตัวเลขได้เลย (เช่น -500000) — ไม่มีช่อง Balance Sign แยก
//
// ไม่กระทบ parser ของ 8 ธนาคาร — เป็นไฟล์ใหม่แยกต่างหาก

import { parseAmount, splitCsvLine, splitLines } from './csv-utils';
import { HEADER_NOT_FOUND, type ParsedBankStatement, type ParsedLine } from './types';

/** map ชื่อหัวตาราง (lower/trim) → ชนิดคอลัมน์ที่ระบบใช้ · ชื่ออื่นที่ไม่รู้จัก = ข้าม */
const COL_ALIASES: Record<string, string[]> = {
  account: ['account number', 'account no', 'account', 'เลขที่บัญชี', 'เลขบัญชี'],
  date: ['date', 'วันที่', 'วันที่ทำรายการ'],
  time: ['time', 'เวลา'],
  txncode: ['transaction code', 'txn code', 'รหัสรายการ'],
  debit: ['debit', 'debit amount', 'เงินออก', 'ถอน'],
  credit: ['credit', 'credit amount', 'เงินเข้า', 'ฝาก'],
  balance: ['balance', 'balance amount', 'ยอดคงเหลือ'],
  description: ['description', 'memo', 'รายละเอียด', 'หมายเหตุ'],
};

/** "01/04/2026" (CE) หรือ ISO "2026-04-01" → "2026-04-01" */
function parseGenericDate(s: string): string | null {
  const t = (s ?? '').trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const p = t.split('/');
  if (p.length !== 3) return null;
  const [d, m, y] = p.map((x) => parseInt(x, 10));
  if (![d, m, y].every(Number.isFinite)) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** หัวตารางดูเหมือนฟอร์แมตกลางไหม — ใช้ชื่อสั้น Debit/Credit/Balance (ต่างจาก SCB) */
export function looksLikeGeneric(head: string): boolean {
  const first = splitLines(head)[0] ?? '';
  const toks = first.split(',').map((s) => s.trim().toLowerCase());
  const has = (k: string) => toks.includes(k);
  // ต้องมี Date + Balance(สั้น) + Debit/Credit(สั้น) + บัญชี · และต้องไม่ใช่ SCB (ไม่มี 'balance sign')
  const hasAccount = toks.some((t) => COL_ALIASES.account.includes(t));
  return hasAccount && has('date') && has('balance')
    && (has('debit') || has('credit')) && !has('balance sign');
}

export function parseGeneric(csvText: string): ParsedBankStatement {
  const all = splitLines(csvText).filter((l) => l.trim() !== '');
  if (all.length < 2) throw new Error(HEADER_NOT_FOUND);

  // สร้าง map: ชนิดคอลัมน์ → ดัชนีคอลัมน์ (จากชื่อหัวตาราง)
  const header = splitCsvLine(all[0]).map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  header.forEach((name, i) => {
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (idx[key] === undefined && aliases.includes(name)) idx[key] = i;
    }
  });
  // คอลัมน์จำเป็นต้องมีหัว — บัญชี/วัน/ยอดคงเหลือ และต้องมี debit หรือ credit อย่างน้อยหนึ่ง
  if (idx.account === undefined || idx.date === undefined || idx.balance === undefined
      || (idx.debit === undefined && idx.credit === undefined)) {
    throw new Error(HEADER_NOT_FOUND);
  }

  const get = (cols: string[], key: string) => (idx[key] === undefined ? '' : (cols[idx[key]] ?? '').trim());
  const rows: ParsedLine[] = [];
  let accountNo = '';

  for (let i = 1; i < all.length; i++) {
    const cols = splitCsvLine(all[i]);
    const dateRaw = get(cols, 'date');
    const date = parseGenericDate(dateRaw);
    if (!date) continue; // แถวไม่มีวันที่ที่อ่านได้ → ข้าม (กันแถวว่าง/ท้ายไฟล์)
    if (!accountNo) accountNo = get(cols, 'account');
    rows.push({
      tx_date: date,
      tx_time: get(cols, 'time') || undefined,
      txn_code: get(cols, 'txncode') || undefined,
      description: get(cols, 'description'),
      debit: parseAmount(get(cols, 'debit')),
      credit: parseAmount(get(cols, 'credit')),
      balance: parseAmount(get(cols, 'balance')), // ติดลบด้วย '-' หรือ (วงเล็บ) ได้
    });
  }
  if (rows.length === 0) throw new Error('ฟอร์แมตกลาง: ไม่พบรายการ (ตรวจคอลัมน์ Date/Balance)');

  const period = rows[0].tx_date.slice(0, 7); // YYYY-MM
  return {
    bank: 'MGC' as any, // sentinel — ไม่ใช่ธนาคาร · หน้าจอใช้ finance_institution ที่ผู้ใช้เลือกเอง
    account_no: accountNo,
    statement_period: period,
    statement_name: `ฟอร์แมตกลาง ${period}`,
    lines: rows,
  };
}
