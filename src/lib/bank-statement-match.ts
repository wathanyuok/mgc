/**
 * Bank Statement → Facility reconciliation helpers (Lvl 1 Lite).
 *
 * Per MoM Day 4 §8.1:
 *   HP + Bank-Credit Lease → "ตัดชำระที่ระบบ Lease โดยตรง · ใช้ Import Bank Statement"
 *
 * Scope: manual link only (no JE flow change). Used to render "✓ Bank Confirmed"
 * badge in each tx module's schedule once user manually matches a BS line.
 *
 * Skipped:
 *   - OD: already has its own bank_statement integration
 *   - LG/BG: fee-only, no per-period reconcile
 *   - Lease IFRS 16 (use_bank_loan=false): paid via NetSuite AP per MoM §8.2
 */
import { supabase } from './supabase';

export type FacilityType =
  | 'P/N'
  | 'LG'
  | 'LC'
  | 'FP'
  | 'OD'
  | 'TR'
  | 'FXF'
  | 'Loan'
  | 'HP'
  | 'Lease';

export interface BankConfirmedLine {
  /** bank_statement_lines.id */
  id: string;
  /** Parent statement id — for linking to /master/bank-statement/:id */
  bank_statement_id: string;
  /** Transaction date on the bank statement */
  txn_date: string;
  /** Description from the bank */
  description: string | null;
  /** Amount (debit/credit depending on bank format) */
  amount: number;
  /** Installment / period number — null for one-time settlements */
  source_period: number | null;
}

/**
 * Fetch all bank_statement_lines linked to a given facility.
 * Returns a Map keyed by source_period (for installment-based facilities like Loan/HP/Lease)
 * plus a `oneTime` field for facilities with no period (TR/LC/FXF).
 */
export async function fetchBankConfirmed(
  facilityType: FacilityType,
  facilityId: string,
): Promise<{ byPeriod: Map<number, BankConfirmedLine>; oneTime: BankConfirmedLine[] }> {
  const { data, error } = await supabase
    .from('bank_statement_lines')
    .select('id, statement_id, tx_date, description, debit, credit, source_period')
    .eq('facility_type', facilityType)
    .eq('facility_id', facilityId);
  if (error) throw error;

  const byPeriod = new Map<number, BankConfirmedLine>();
  const oneTime: BankConfirmedLine[] = [];
  (data ?? []).forEach((row: any) => {
    // Schedule "payment" is the Debit (money out) for HP/Lease/Loan; Credit = received (rare).
    const amount = Number(row.debit ?? 0) > 0 ? Number(row.debit) : Number(row.credit ?? 0);
    const line: BankConfirmedLine = {
      id: row.id,
      bank_statement_id: row.statement_id,
      txn_date: row.tx_date,
      description: row.description,
      amount,
      source_period: row.source_period,
    };
    if (line.source_period != null) {
      byPeriod.set(line.source_period, line);
    } else {
      oneTime.push(line);
    }
  });
  return { byPeriod, oneTime };
}

/** Convenience: build a React Query queryKey for one facility. */
export function bankConfirmedQueryKey(facilityType: FacilityType, facilityId: string | undefined) {
  return ['bank-confirmed', facilityType, facilityId] as const;
}
