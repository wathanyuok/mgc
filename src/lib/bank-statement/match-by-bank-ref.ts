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
// After Migration 0074, bank_statement_lines.facility_type is now
// facility_type_id UUID FK → facility_types. We return both:
//   - facility_type_id (UUID for DB writes)
//   - facility_code (canonical code for downstream logic branches)

import { supabase } from '@/lib/supabase';
import { facilityTypeIdByCode } from '@/lib/facility-types';

export type FacilityCode = 'PN' | 'LG' | 'OD' | 'TR' | 'FXF' | 'LC' | 'LOAN' | 'FP' | 'HP' | 'LEASE';

export type FacilityMatch = {
  facility_type_id: string;
  facility_code: FacilityCode;
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
  console.log('[matchByBankRef] searching ref:', JSON.stringify(trimmed));

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

  console.log('[matchByBankRef] results:', {
    pn: pn.data, pnError: pn.error?.message,
    lg: lg.data, od: od.data, tr: tr.data,
    fxf: fxf.data, lc: lc.data,
    loan: loan.data, fp: fp.data, lease: lease.data,
  });

  const order: [any, FacilityCode][] = [
    [pn.data, 'PN'],
    [lg.data, 'LG'],
    [od.data, 'OD'],
    [tr.data, 'TR'],
    [fxf.data, 'FXF'],
    [lc.data, 'LC'],
    [loan.data, 'LOAN'],
    [fp.data, 'FP'],
  ];
  for (const [row, code] of order) {
    if (row?.id) {
      const id = await facilityTypeIdByCode(code);
      if (!id) continue;
      return { facility_type_id: id, facility_code: code, facility_id: row.id };
    }
  }
  // Lease is special — one table, two facility codes based on mode.
  if (lease.data?.id) {
    const code: FacilityCode = (lease.data as any).mode === 'hp' ? 'HP' : 'LEASE';
    const id = await facilityTypeIdByCode(code);
    if (id) {
      return { facility_type_id: id, facility_code: code, facility_id: lease.data.id };
    }
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

/**
 * Extract cheque number from a bank line's description or remark.
 * KBANK writes "KBANK 0733 เช็คเลขที่ 90000096" in description.
 * SCB has its own Cheque Number column (parser folds it into remark as "เช็ค 90000096").
 * Both patterns supported.
 */
export function extractChequeNo(description: string | null | undefined, remark: string | null | undefined): string | null {
  const text = `${description ?? ''} ${remark ?? ''}`;
  const m = /เช็คเลขที่\s+(\d+)/.exec(text) || /เช็ค\s+(\d+)/.exec(text);
  return m ? m[1] : null;
}

/**
 * Match a bank line to an AP Cheque Request that MGC previously issued.
 * Used for OUTGOING lines (MGC paid a vendor/lessor via cheque):
 *   1. Extract cheque_no from description/remark
 *   2. Look up ap_cheque_requests.cheque_no
 *   3. Resolve source_type → facility via repayments/leases/loans
 *
 * NetSuite AP module is expected to sync cheque_no back to
 * ap_cheque_requests.cheque_no after issuing — until that integration
 * is live, this only matches cheques manually recorded on the L&L side.
 */
export async function matchByChequeNo(chequeNo: string): Promise<FacilityMatch | null> {
  const trimmed = chequeNo.trim();
  if (!trimmed) return null;
  console.log('[matchByChequeNo] searching cheque_no:', JSON.stringify(trimmed));

  const { data: apReq, error } = await supabase
    .from('ap_cheque_requests')
    .select('id, source_type, source_id')
    .eq('cheque_no', trimmed)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('[matchByChequeNo] error:', error.message);
    return null;
  }
  if (!apReq) {
    console.log('[matchByChequeNo] no ap_cheque_requests row');
    return null;
  }
  console.log('[matchByChequeNo] found ap_cheque_request:', apReq);

  // Resolve source_type to facility.
  // source_type ∈ 'REPAYMENT' | 'LEASE_PAYMENT' | 'LOAN_INTEREST'
  // REPAYMENT: source_id → repayments.facility_type_id + facility_id
  // LEASE_PAYMENT: source_id → leases directly (HP vs LEASE from mode)
  // LOAN_INTEREST: source_id → loans directly

  if (apReq.source_type === 'REPAYMENT') {
    const { data: rep } = await supabase
      .from('repayments')
      .select('facility_type_id, facility_id, facility_types(code)')
      .eq('id', apReq.source_id)
      .maybeSingle();
    if (rep?.facility_type_id && rep?.facility_id) {
      const code = ((rep as any).facility_types?.code ?? null) as FacilityCode | null;
      if (code) {
        return {
          facility_type_id: rep.facility_type_id,
          facility_code: code,
          facility_id: rep.facility_id,
        };
      }
    }
  } else if (apReq.source_type === 'LEASE_PAYMENT') {
    const { data: lease } = await supabase
      .from('leases')
      .select('mode')
      .eq('id', apReq.source_id)
      .maybeSingle();
    const code: FacilityCode = (lease as any)?.mode === 'hp' ? 'HP' : 'LEASE';
    const id = await facilityTypeIdByCode(code);
    if (id) {
      return { facility_type_id: id, facility_code: code, facility_id: apReq.source_id };
    }
  } else if (apReq.source_type === 'LOAN_INTEREST') {
    const id = await facilityTypeIdByCode('LOAN');
    if (id) return { facility_type_id: id, facility_code: 'LOAN', facility_id: apReq.source_id };
  }
  return null;
}
