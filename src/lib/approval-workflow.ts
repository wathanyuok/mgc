// Approval Workflow — Feature C2 (Maker / Checker / Approver)
// ---------------------------------------------------------------
// Enforces a two-step handoff before a facility becomes Active/Approved:
//
//   Draft (Maker creates)
//     → Ready for Approval (Maker clicks "Submit")
//         → Approved / Active (Approver clicks "Approve")
//         ↓ (Approver clicks "Reject" with reason)
//     Draft (rejection_reason set · submitted_at cleared)
//
// Any of the 9 facility tables (loans, promissory_notes, floor_plans, ...)
// can adopt this by using the shared columns from migration 0060.

import { supabase } from './supabase';
import { logAudit } from './audit-trail';

export type ApprovalFacility =
  | 'loans'
  | 'promissory_notes'
  | 'floor_plans'
  | 'overdrafts'
  | 'trust_receipts'
  | 'letter_guarantees'
  | 'letters_of_credit'
  | 'leases'
  | 'fx_forwards';

export interface ApprovalState {
  is_submitted: boolean;
  is_approved: boolean;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
}

/** Read the approval state of a facility row. */
export async function fetchApprovalState(
  table: ApprovalFacility,
  id: string,
): Promise<ApprovalState> {
  const { data, error } = await supabase
    .from(table)
    .select('submitted_by, submitted_at, approved_by, approved_at, rejection_reason')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const row: any = data ?? {};
  return {
    is_submitted: !!row.submitted_at,
    is_approved: !!row.approved_at,
    submitted_by: row.submitted_by ?? null,
    submitted_at: row.submitted_at ?? null,
    approved_by: row.approved_by ?? null,
    approved_at: row.approved_at ?? null,
    rejection_reason: row.rejection_reason ?? null,
  };
}

/** Maker submits the row for approval. Status stays Draft; only flags change. */
export async function submitForApproval(
  table: ApprovalFacility,
  id: string,
  user_label: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from(table)
    .update({
      submitted_by: user_label,
      submitted_at: now,
      rejection_reason: null,       // clear prior rejection
      updated_at: now,
    })
    .eq('id', id);
  if (error) throw error;
  await logAudit({
    action: 'approve',              // reuse existing audit action
    table,
    recordId: id,
    summary: `Submitted for approval by ${user_label}`,
  });
}

/**
 * Approver approves the row. Sets approved_at + approved_by, and (optionally)
 * transitions the status via `statusFieldName` / `statusApprovedValue` — pass
 * these when the module wants status to auto-move (e.g. Loan: Draft → Active).
 */
export async function approveFacility(
  table: ApprovalFacility,
  id: string,
  user_label: string,
  statusFieldName?: string,
  statusApprovedValue?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    approved_by: user_label,
    approved_at: now,
    updated_at: now,
  };
  if (statusFieldName && statusApprovedValue) {
    patch[statusFieldName] = statusApprovedValue;
  }
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) throw error;
  await logAudit({
    action: 'approve',
    table,
    recordId: id,
    summary: `Approved by ${user_label}${statusApprovedValue ? ` · status → ${statusApprovedValue}` : ''}`,
  });
}

/** Approver rejects the row. Reason stays; user must fix + re-submit. */
export async function rejectFacility(
  table: ApprovalFacility,
  id: string,
  user_label: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from(table)
    .update({
      rejection_reason: reason,
      submitted_at: null,       // clear submission so Maker sees Draft state again
      submitted_by: null,
      updated_at: now,
    })
    .eq('id', id);
  if (error) throw error;
  await logAudit({
    action: 'reject',
    table,
    recordId: id,
    summary: `Rejected by ${user_label}: ${reason}`,
  });
}
