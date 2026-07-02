// Bank Reference matching — Tier 1 for SCB MCL <11-digit>.
// Searches all 9 facility tables (each with its own bank-ref column name)
// and returns the first match. Used by Bank Statement Import to auto-link
// parsed rows before the user sees the preview table.
//
// Column-name map (as verified against migrations + Detail files):
//   promissory_notes → pn_number
//   letter_guarantees → lg_no
//   overdrafts → account_no
//   trust_receipts → tr_no
//   fx_forwards → fxf_no
//   letters_of_credit → lc_no
//   loans → bank_ref            (added in Migration 0062)
//   floor_plans → bank_ref      (added in Migration 0062)
//   leases → bank_ref           (added in Migration 0062)
//
// facility_type values align with bank_statement_lines.facility_type enum
// used elsewhere in the codebase: 'P/N' | 'LG' | 'OD' | 'TR' | 'FXF' | 'LC'
// | 'Loan' | 'FP' | 'HP' | 'Lease'. Lease is split into HP vs Lease based
// on leases.mode.

import { supabase } from '@/lib/supabase';

export type FacilityMatch = {
  facility_type: 'P/N' | 'LG' | 'OD' | 'TR' | 'FXF' | 'LC' | 'Loan' | 'FP' | 'HP' | 'Lease';
  facility_id: string;
};

/**
 * Search all 9 facility tables for a given Bank Reference value.
 * Returns the first hit. Runs 9 queries in parallel — safe at import time
 * because Supabase indexes each ref column.
 */
export async function matchByBankRef(ref: string): Promise<FacilityMatch | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const [pn, lg, od, tr, fxf, lc, loan, fp, lease] = await Promise.all([
    supabase.from('promissory_notes').select('id').eq('pn_number', trimmed).limit(1).maybeSingle(),
    supabase.from('letter_guarantees').select('id').eq('lg_no', trimmed).limit(1).maybeSingle(),
    supabase.from('overdrafts').select('id').eq('account_no', trimmed).limit(1).maybeSingle(),
    supabase.from('trust_receipts').select('id').eq('tr_no', trimmed).limit(1).maybeSingle(),
    supabase.from('fx_forwards').select('id').eq('fxf_no', trimmed).limit(1).maybeSingle(),
    supabase.from('letters_of_credit').select('id').eq('lc_no', trimmed).limit(1).maybeSingle(),
    supabase.from('loans').select('id').eq('bank_ref', trimmed).limit(1).maybeSingle(),
    supabase.from('floor_plans').select('id').eq('bank_ref', trimmed).limit(1).maybeSingle(),
    supabase.from('leases').select('id, mode').eq('bank_ref', trimmed).limit(1).maybeSingle(),
  ]);

  const order: [any, FacilityMatch['facility_type']][] = [
    [pn.data, 'P/N'],
    [lg.data, 'LG'],
    [od.data, 'OD'],
    [tr.data, 'TR'],
    [fxf.data, 'FXF'],
    [lc.data, 'LC'],
    [loan.data, 'Loan'],
    [fp.data, 'FP'],
  ];
  for (const [row, facility_type] of order) {
    if (row?.id) return { facility_type, facility_id: row.id };
  }
  // Lease is special — one table, two facility_type values based on mode.
  if (lease.data?.id) {
    const facility_type: FacilityMatch['facility_type'] =
      (lease.data as any).mode === 'hp' ? 'HP' : 'Lease';
    return { facility_type, facility_id: lease.data.id };
  }
  return null;
}

/**
 * Parse SCB MCL pattern from a bank line description.
 * Format: 'MCL <11-digit> <5-digit>' where the 5-digit is the installment period.
 */
export function extractMCL(description: string | null | undefined): { ref: string; period: number } | null {
  if (!description) return null;
  const m = /MCL\s+(\d{11})\s+(\d{5})/.exec(description);
  if (!m) return null;
  return { ref: m[1], period: parseInt(m[2], 10) };
}
