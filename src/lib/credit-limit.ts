// Credit-line enforcement: facility (CA) มี credit_line · transaction กิน utilization
// Available = credit_line − Σ outstanding ของทุก transaction ใต้ CA เดียวกัน
// เบิกเกิน Available ไม่ได้ — ระบบแจ้ง "วงเงินเต็ม / เกินวงเงิน"
// (Loan session §93/§420/§663/§1014, Lease §207)
import { supabase } from './supabase';

// Revolving: line replenishes when a transaction is repaid/closed → exclude these.
//
// สถานะที่แปลว่า "สัญญาจบแล้ว วงเงินคืนมา" ต้องครบทุกทางที่สัญญาจบได้ ไม่ใช่แค่บางทาง
// เดิมตกไป 4 ค่า: หนังสือค้ำประกันที่หมดอายุ (Expired) หรือยกเลิกก่อนกำหนด (Terminated)
// ยังกินวงเงินอยู่ตลอดไป · L/C ที่แปลงเป็นทรัสต์รีซีทแล้ว (Converted) และสัญญาซื้อขาย
// เงินตราที่ส่งมอบแล้ว (Settled) ก็เช่นกัน — ทำให้หน้าบันทึกฟ้องวงเงินเต็มทั้งที่รายงานบอกว่าเหลือ
export const CLOSED_STATUS_LIST = [
  'Repaid', 'Closed', 'Cancelled', 'Rejected', 'Roll Over', 'Voided',
  'Expired', 'Terminated', 'Converted', 'Settled',
] as const;
const CLOSED_STATUSES = `(${CLOSED_STATUS_LIST.map((s) => `"${s}"`).join(',')})`;
// Non-Revolving: a drawdown consumes the line permanently — even
// after repay/close it does NOT replenish. Only never-drawn statuses are excluded.
export const NEVER_DREW_STATUS_LIST = ['Cancelled', 'Rejected', 'Voided'] as const;
const NEVER_DREW_STATUSES = `(${NEVER_DREW_STATUS_LIST.map((s) => `"${s}"`).join(',')})`;

// ตารางธุรกรรมที่กินวงเงินของ CA + คอลัมน์ยอดเงิน
//
// นี่คือแหล่งเดียวของรายการนี้ — รายงานการใช้วงเงินก็ import ไปใช้ตัวนี้
// เดิมแยกกันคนละไฟล์แล้วค่อยๆ เพี้ยนออกจากกัน: หน้าบันทึกไม่นับ L/C กับสัญญาเช่า
// แต่รายงานนับ ทำให้สองหน้าจอบอกตัวเลขคนละอย่างบน CA เดียวกัน
export const DRAWDOWN_TABLES: { table: string; amountCol: string }[] = [
  { table: 'loans', amountCol: 'principal' },
  { table: 'promissory_notes', amountCol: 'amount' },
  { table: 'letter_guarantees', amountCol: 'amount' },
  { table: 'letters_of_credit', amountCol: 'amount' },
  { table: 'floor_plans', amountCol: 'amount' },
  { table: 'overdrafts', amountCol: 'amount' },
  { table: 'trust_receipts', amountCol: 'amount' },
  // สัญญาซื้อขายเงินตราล่วงหน้าผูกวงเงินเหมือนโมดูลอื่น แต่เดิมไม่เคยถูกนับเลย
  // ยอดที่กินวงเงินคือยอดบาท (amount_thb) ไม่ใช่ยอดสกุลต่างประเทศ
  { table: 'fx_forwards', amountCol: 'amount_thb' },
  // สัญญาเช่าแบบไม่ใช้สินเชื่อไม่ผูก CA (ca_id ว่าง) จึงถูกคัดออกเองตอนกรองด้วย ca_id
  { table: 'leases', amountCol: 'principal' },
];

// สถานะที่แปลว่าจบเฉพาะบางตาราง — เพราะคำเดียวกันหมายความคนละอย่างในแต่ละโมดูล
//
// "Modified" ในเงินกู้ยืม = แก้เงื่อนไขแล้วเปิดสัญญาใหม่แทน สัญญาเดิมจบไปแล้ว
//   ถ้าไม่คัดออก วงเงินจะถูกนับทั้งสัญญาเดิมและสัญญาใหม่พร้อมกัน = ใช้ซ้ำ 2 เท่า
// "Modified" ในสัญญาเช่า = ปรับปรุงมูลค่าในสัญญาฉบับเดิม สัญญายังมีผลบังคับใช้
//   จึงต้องยังกินวงเงินอยู่ — ห้ามคัดออก
export const EXTRA_CLOSED_BY_TABLE: Record<string, readonly string[]> = {
  loans: ['Modified'],
};

// L/C ที่แบ่งรับมอบเป็น lot จะสร้างสัญญาย่อยที่ผูก CA เดียวกัน
// ถ้านับทั้งสัญญาแม่และสัญญาย่อย วงเงินจะถูกนับซ้ำเป็นสองเท่า — นับเฉพาะสัญญาแม่
export const isSubContract = (table: string, row: any) =>
  table === 'letters_of_credit' && !!row?.parent_lc_id;

export interface CreditAvailability {
  creditLine: number;
  used: number;
  available: number;
  creditType: string;
}

/**
 * Compute remaining available credit for a CA across all linked transactions.
 * `exclude` skips the current transaction (so editing doesn't double-count itself).
 * Returns null if the CA can't be loaded.
 */
export async function getCreditAvailability(
  caId: string,
  exclude?: { table: string; id: string | null | undefined },
): Promise<CreditAvailability | null> {
  const { data: ca } = await supabase
    .from('credit_agreements')
    .select('credit_line, credit_type')
    .eq('id', caId)
    .maybeSingle();
  if (!ca) return null;

  // Non-Revolving consumes the line permanently (cumulative drawdown); Revolving frees
  // up on repay/close. The exclusion set differs by credit type.
  const isNonRevolving = String(ca.credit_type ?? '').toLowerCase().includes('non');
  const excludeStatuses = isNonRevolving ? NEVER_DREW_STATUSES : CLOSED_STATUSES;

  let used = 0;
  for (const t of DRAWDOWN_TABLES) {
    const cols = t.table === 'letters_of_credit'
      ? `id, status, parent_lc_id, ${t.amountCol}`
      : `id, status, ${t.amountCol}`;
    const extra = EXTRA_CLOSED_BY_TABLE[t.table] ?? [];
    const excludeForTable = extra.length
      ? `(${[...(isNonRevolving ? NEVER_DREW_STATUS_LIST : CLOSED_STATUS_LIST), ...extra]
          .map((s) => `"${s}"`).join(',')})`
      : excludeStatuses;
    const { data } = await supabase
      .from(t.table)
      .select(cols)
      .eq('ca_id', caId)
      .not('status', 'in', excludeForTable);
    for (const row of (data ?? []) as any[]) {
      if (exclude && t.table === exclude.table && exclude.id && row.id === exclude.id) continue;
      if (isSubContract(t.table, row)) continue;
      used += Number(row[t.amountCol] ?? 0);
    }
  }

  const creditLine = Number(ca.credit_line ?? 0);
  return { creditLine, used, available: creditLine - used, creditType: ca.credit_type ?? '' };
}

/** baht formatter for messages (avoids importing format util into the lib) */
function thb(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Throw a.
 * No-op when there's no CA linked. Call inside a save/activate mutation.
 */
export async function assertWithinCreditLine(
  caId: string | null | undefined,
  amount: number,
  exclude?: { table: string; id: string | null | undefined },
): Promise<void> {
  if (!caId || !amount) return;
  const a = await getCreditAvailability(caId, exclude);
  if (!a) return;
  if (amount > a.available + 0.005) {
    throw new Error(
      `วงเงินเต็มแล้ว — วงเงิน ${thb(a.creditLine)} · ใช้ไป ${thb(a.used)} · คงเหลือ ${thb(a.available)} ` +
        `· รายการนี้ ${thb(amount)} เกินวงเงิน ขอเพิ่มไม่ได้ (ต้องเพิ่มวงเงินที่ MA/CA ก่อน)`,
    );
  }
}
