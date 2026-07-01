// Facility Manual Reconcile Adjustment — Feature C3 (polymorphic)
// ---------------------------------------------------------------
// Workshop guidance (3.txt §3-75):
//   "Loan" ในความหมายกว้าง = ทุก Loan-side facility ที่รอ Bank Statement (T+2):
//     Loan · PN · FP · OD · TR
//   Lease + HP excluded (schedule-driven, ตัดอัตโนมัติ).
//
// Bank cut → total พอตัดจริงแล้วอาจไม่ตรง P/I ตาม schedule ·
// user "manual adjust" · ระบบต้อง log ทั้ง original + adjusted + reason +
// refund flag · post JE reallocation ระหว่าง Interest ↔ Principal.
//
// JE Pattern:
//   Δ = adjusted_principal − original_principal
//   ถ้า Δ > 0 (โอนจาก Interest → Principal):
//     Dr Interest Income     Δ      -- ลดรายได้ดอกเบี้ยที่รับรู้ไปแล้ว
//     Cr Loan Principal Recv Δ      -- เพิ่มลด principal outstanding ที่ตัดไป
//   ถ้า Δ < 0 (กลับด้าน)

import { supabase } from './supabase';
import { createJE, postJE } from './je';

export const FACILITY_ADJUST_GL = {
  interestIncome:  { code: '410100', name: 'Interest Income' },
  loanPrincipal:   { code: '120200', name: 'Loan Receivable — Principal' },
};

export type AdjustFacilityType = 'Loan' | 'PN' | 'FP' | 'OD' | 'TR';
export type LoanAdjustReason = 'rate_change' | 'day_diff' | 'bank_overcut' | 'other';

export interface FacilityAdjustInput {
  facility_type: AdjustFacilityType;
  facility_id: string;
  facility_no?: string;               // for JE description (e.g. loan_no, pn_no)
  period: number;
  bank_statement_line_id?: string | null;
  original_principal: number;
  original_interest: number;
  adjusted_principal: number;
  adjusted_interest: number;
  reason: LoanAdjustReason;
  refund_pending?: boolean;
  refund_amount?: number;
  notes?: string;
}

export interface FacilityAdjustment {
  id: string;
  facility_type: AdjustFacilityType;
  facility_id: string;
  period: number;
  bank_statement_line_id: string | null;
  original_principal: number;
  original_interest: number;
  original_total: number;
  adjusted_principal: number;
  adjusted_interest: number;
  adjusted_total: number;
  refund_pending: boolean;
  refund_amount: number;
  refund_received_date: string | null;
  reason: LoanAdjustReason;
  notes: string | null;
  je_id: string | null;
  status: 'Draft' | 'Posted' | 'Reversed';
  created_at: string;
}

/**
 * Persist a reconciliation adjustment and post the reallocation JE.
 * The adjusted totals must sum to the same number as the originals
 * (we don't recognise more cash — just re-split it). If the bank cut
 * MORE than the schedule, use refund_pending + refund_amount separately.
 */
export async function postFacilityAdjustment(input: FacilityAdjustInput): Promise<FacilityAdjustment> {
  const origP = round2(input.original_principal);
  const origI = round2(input.original_interest);
  const origTotal = round2(origP + origI);

  const adjP = round2(input.adjusted_principal);
  const adjI = round2(input.adjusted_interest);
  const adjTotal = round2(adjP + adjI);

  const refundPending = !!input.refund_pending;
  const refundAmount = refundPending ? round2(input.refund_amount ?? 0) : 0;

  if (Math.abs(adjTotal - origTotal) > 0.01) {
    throw new Error(
      `Adjusted total (${adjTotal}) must equal original total (${origTotal}). ` +
      `If bank cut differs, use "refund pending" instead of changing the total.`
    );
  }

  const { data: row, error } = await supabase
    .from('facility_adjustments')
    .insert({
      facility_type: input.facility_type,
      facility_id: input.facility_id,
      period: input.period,
      bank_statement_line_id: input.bank_statement_line_id ?? null,
      original_principal: origP,
      original_interest: origI,
      original_total: origTotal,
      adjusted_principal: adjP,
      adjusted_interest: adjI,
      adjusted_total: adjTotal,
      refund_pending: refundPending,
      refund_amount: refundAmount,
      reason: input.reason,
      notes: input.notes ?? null,
      status: 'Posted',
    })
    .select()
    .single();
  if (error) throw error;
  if (!row) throw new Error('insert facility_adjustments returned no row');

  const delta = round2(adjP - origP);
  const today = new Date().toISOString().slice(0, 10);
  const facLabel = input.facility_no ?? `${input.facility_type}/${input.facility_id.slice(0, 8)}`;
  let jeId: string | null = null;

  if (Math.abs(delta) >= 0.01) {
    const amt = Math.abs(delta);
    const lines = delta > 0
      ? [
          {
            account_code: FACILITY_ADJUST_GL.interestIncome.code,
            account_name: FACILITY_ADJUST_GL.interestIncome.name,
            dr: amt,
            description: `Reallocate: reduce interest recognised — ${facLabel} period ${input.period}`,
          },
          {
            account_code: FACILITY_ADJUST_GL.loanPrincipal.code,
            account_name: FACILITY_ADJUST_GL.loanPrincipal.name,
            cr: amt,
            description: `Reallocate: increase principal cut — ${facLabel} period ${input.period}`,
          },
        ]
      : [
          {
            account_code: FACILITY_ADJUST_GL.loanPrincipal.code,
            account_name: FACILITY_ADJUST_GL.loanPrincipal.name,
            dr: amt,
            description: `Reallocate: reverse principal cut — ${facLabel} period ${input.period}`,
          },
          {
            account_code: FACILITY_ADJUST_GL.interestIncome.code,
            account_name: FACILITY_ADJUST_GL.interestIncome.name,
            cr: amt,
            description: `Reallocate: increase interest recognised — ${facLabel} period ${input.period}`,
          },
        ];

    const je = await createJE({
      source_type: 'FACILITY_ADJUST',
      source_id: row.id,
      je_date: today,
      description: `Reconcile — ${facLabel} period ${input.period} (${input.reason})`,
      remark: `${input.facility_type} · Δ principal ${delta.toFixed(2)} · reason=${input.reason}${input.notes ? ' · ' + input.notes : ''}`,
      lines,
    });
    await postJE(je.id, 'user');
    jeId = je.id;

    await supabase
      .from('facility_adjustments')
      .update({ je_id: jeId, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  return { ...(row as any), je_id: jeId };
}

/** List all adjustments for a given facility, oldest period first, latest first within period. */
export async function listFacilityAdjustments(
  facility_type: AdjustFacilityType,
  facility_id: string,
): Promise<FacilityAdjustment[]> {
  const { data, error } = await supabase
    .from('facility_adjustments')
    .select('*')
    .eq('facility_type', facility_type)
    .eq('facility_id', facility_id)
    .order('period', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FacilityAdjustment[];
}

export async function markRefundReceived(adjustment_id: string, received_date: string) {
  const { error } = await supabase
    .from('facility_adjustments')
    .update({
      refund_pending: false,
      refund_received_date: received_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adjustment_id);
  if (error) throw error;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
