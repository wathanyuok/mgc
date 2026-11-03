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

// ─────────────────────────────────────────────────────────────────────────
// BATCH versions — ใช้ตอน Import หลายพันแถว เพื่อไม่ให้ยิง DB ทีละแถว (ช้ามาก)
// ยิง .in() ครั้งเดียวต่อ 1 ตาราง แล้วทำ Map ให้ caller หยิบไปใช้
// ─────────────────────────────────────────────────────────────────────────

const REF_TABLES: { table: string; col: string; code: FacilityCode }[] = [
  { table: 'promissory_notes', col: 'pn_number', code: 'PN' },
  { table: 'letter_guarantees', col: 'lg_no', code: 'LG' },
  { table: 'overdrafts', col: 'account_no', code: 'OD' },
  { table: 'trust_receipts', col: 'tr_no', code: 'TR' },
  { table: 'fx_forwards', col: 'fxf_no', code: 'FXF' },
  { table: 'letters_of_credit', col: 'lc_no', code: 'LC' },
  { table: 'loans', col: 'bank_ref', code: 'LOAN' },
  { table: 'floor_plans', col: 'bank_ref', code: 'FP' },
];

/** จับคู่ bank-ref หลายค่าในครั้งเดียว → Map<ref, FacilityMatch> */
export async function matchByBankRefBatch(refs: string[]): Promise<Map<string, FacilityMatch>> {
  const out = new Map<string, FacilityMatch>();
  const uniq = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  if (uniq.length === 0) return out;

  const typeIdCache = new Map<FacilityCode, string | null>();
  const typeId = async (c: FacilityCode) => {
    if (!typeIdCache.has(c)) typeIdCache.set(c, await facilityTypeIdByCode(c));
    return typeIdCache.get(c) ?? null;
  };

  // ยิงทีละตารางตามลำดับความสำคัญ — ref ที่เจอแล้วไม่เขียนทับ (ตารางก่อนชนะ)
  for (const { table, col, code } of REF_TABLES) {
    const { data, error } = await supabase.from(table).select(`id, ${col}`).in(col, uniq);
    if (error || !data) continue;
    const tid = await typeId(code);
    if (!tid) continue;
    for (const row of data as any[]) {
      const key = String(row[col]).trim();
      if (!out.has(key)) out.set(key, { facility_type_id: tid, facility_code: code, facility_id: row.id });
    }
  }
  return out;
}

/** จับคู่เลขเช็คหลายค่าในครั้งเดียว → Map<cheque_no, FacilityMatch> */
export async function matchByChequeNoBatch(chequeNos: string[]): Promise<Map<string, FacilityMatch>> {
  const out = new Map<string, FacilityMatch>();
  const uniq = [...new Set(chequeNos.map((c) => c.trim()).filter(Boolean))];
  if (uniq.length === 0) return out;

  const { data: apReqs } = await supabase
    .from('ap_cheque_requests')
    .select('cheque_no, source_type, source_id')
    .in('cheque_no', uniq);
  if (!apReqs || apReqs.length === 0) return out;

  const repIds = (apReqs as any[]).filter((a) => a.source_type === 'REPAYMENT').map((a) => a.source_id);
  const leaseIds = (apReqs as any[]).filter((a) => a.source_type === 'LEASE_PAYMENT').map((a) => a.source_id);

  const repMap = new Map<string, { facility_type_id: string; facility_id: string; code: FacilityCode }>();
  if (repIds.length) {
    const { data } = await supabase.from('repayments')
      .select('id, facility_type_id, facility_id, facility_types(code)').in('id', repIds);
    for (const r of (data as any[]) ?? []) {
      const code = r.facility_types?.code as FacilityCode | undefined;
      if (r.facility_type_id && r.facility_id && code) {
        repMap.set(r.id, { facility_type_id: r.facility_type_id, facility_id: r.facility_id, code });
      }
    }
  }
  const leaseMap = new Map<string, FacilityCode>();
  if (leaseIds.length) {
    const { data } = await supabase.from('leases').select('id, mode').in('id', leaseIds);
    for (const l of (data as any[]) ?? []) leaseMap.set(l.id, l.mode === 'hp' ? 'HP' : 'LEASE');
  }
  const typeIdCache = new Map<FacilityCode, string | null>();
  const typeId = async (c: FacilityCode) => {
    if (!typeIdCache.has(c)) typeIdCache.set(c, await facilityTypeIdByCode(c));
    return typeIdCache.get(c) ?? null;
  };

  for (const a of apReqs as any[]) {
    const chq = String(a.cheque_no).trim();
    if (out.has(chq)) continue;
    if (a.source_type === 'REPAYMENT') {
      const rep = repMap.get(a.source_id);
      if (rep) out.set(chq, { facility_type_id: rep.facility_type_id, facility_code: rep.code, facility_id: rep.facility_id });
    } else if (a.source_type === 'LEASE_PAYMENT') {
      const code = leaseMap.get(a.source_id) ?? 'LEASE';
      const tid = await typeId(code);
      if (tid) out.set(chq, { facility_type_id: tid, facility_code: code, facility_id: a.source_id });
    } else if (a.source_type === 'LOAN_INTEREST') {
      const tid = await typeId('LOAN');
      if (tid) out.set(chq, { facility_type_id: tid, facility_code: 'LOAN', facility_id: a.source_id });
    }
  }
  return out;
}
