// Credit-line enforcement (MoM): facility (CA) มี credit_line · transaction กิน utilization
//   Available = credit_line − Σ outstanding ของทุก transaction ใต้ CA เดียวกัน
//   เบิกเกิน Available ไม่ได้ — ระบบแจ้ง "วงเงินเต็ม / เกินวงเงิน"
//   (Loan session §93/§420/§663/§1014, Lease §207)
import { supabase } from './supabase';

// statuses that no longer consume the line (repaid / closed / rolled over / cancelled)
const CLOSED_STATUSES = '("Repaid","Closed","Cancelled","Rejected","Roll Over","Voided")';

// transaction tables that draw down a CA's credit line + their amount column
const DRAWDOWN_TABLES: { table: string; amountCol: string }[] = [
  { table: 'loans', amountCol: 'principal' },
  { table: 'promissory_notes', amountCol: 'amount' },
  { table: 'letter_guarantees', amountCol: 'amount' },
  { table: 'floor_plans', amountCol: 'amount' },
  { table: 'overdrafts', amountCol: 'amount' },
  { table: 'trust_receipts', amountCol: 'amount' },
];

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

  let used = 0;
  for (const t of DRAWDOWN_TABLES) {
    const { data } = await supabase
      .from(t.table)
      .select(`id, status, ${t.amountCol}`)
      .eq('ca_id', caId)
      .not('status', 'in', CLOSED_STATUSES);
    for (const row of (data ?? []) as any[]) {
      if (exclude && t.table === exclude.table && exclude.id && row.id === exclude.id) continue;
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
 * Throw a MoM-style error if `amount` would exceed the CA's available credit.
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
