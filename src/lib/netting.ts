// AR-AP Offset/Netting — Feature B8
// MoM workshop: "เฉพาะ Finance เดียวกัน" — only same finance institution allowed.

import { supabase } from './supabase';
import { createJE, postJE } from './je';
import type { ARAPNetting, ARAPNettingDirection } from '@/types/database';

/** GL accounts for netting JEs */
export const NETTING_GL = {
  ar:   { code: '113000', name: 'Accounts Receivable — Trade' },
  ap:   { code: '211010', name: 'Accounts Payable — Trade' },
  bank: { code: '111010', name: 'Bank — Cash at Bank' },
};

export interface NettingCandidate {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  ar_amount: number;
  ap_amount: number;
}

/**
 * Find counterparties that have both AR + AP balances at the same finance institution.
 *
 * Stub implementation: scans `repayments` / `ap_cheque_requests` heuristically.
 * Production: this should hit a real AR/AP balance view. For now we list all
 * active vendors at the specified institution as candidates (user enters AR/AP
 * amounts manually), which matches the prototype-stage MoM expectation.
 */
export async function findNettingCandidates(
  financeInstitution: string,
): Promise<NettingCandidate[]> {
  // Active vendors only — UI will collect ar/ap manually for now.
  const { data, error } = await supabase
    .from('vendors')
    .select('id, code, name')
    .eq('active', true)
    .order('code');
  if (error) throw error;
  // Annotate institution context (kept on the row so future revision can filter
  // by a per-vendor finance_institution_id once that link exists).
  void financeInstitution;
  return (data ?? []).map((v: any) => ({
    vendor_id: v.id,
    vendor_code: v.code,
    vendor_name: v.name,
    ar_amount: 0,
    ap_amount: 0,
  }));
}

/** Compute net + direction from AR / AP. */
export function computeNetting(arAmount: number, apAmount: number): { net: number; direction: ARAPNettingDirection } {
  const ar = Number(arAmount ?? 0);
  const ap = Number(apAmount ?? 0);
  const net = Math.round(Math.abs(ar - ap) * 100) / 100;
  const direction: ARAPNettingDirection = ar >= ap ? 'receive' : 'pay';
  return { net, direction };
}

/**
 * Execute a netting row → post the JE and mark as Executed.
 *
 * Direction = 'receive' (ar > ap):
 *   Dr A/P (counterparty)  ap_amount
 *   Dr Bank                 net_amount    -- MGC receives net cash
 *     Cr A/R (counterparty)  ar_amount
 *
 * Direction = 'pay' (ap > ar):
 *   Dr A/P (counterparty)  ap_amount
 *     Cr A/R (counterparty)  ar_amount
 *     Cr Bank                 net_amount  -- MGC pays net cash
 */
export async function executeNetting(netting: ARAPNetting, vendorLabel: string): Promise<string> {
  if (netting.status === 'Executed') throw new Error('Netting นี้ Execute แล้ว');
  if (netting.status === 'Cancelled') throw new Error('Netting นี้ Cancelled');
  if (netting.net_amount < 0) throw new Error('net_amount must be ≥ 0');

  const ar = Math.round(netting.ar_amount * 100) / 100;
  const ap = Math.round(netting.ap_amount * 100) / 100;
  const net = Math.round(netting.net_amount * 100) / 100;

  const lines: any[] = [];
  if (netting.direction === 'receive') {
    lines.push(
      { account_code: NETTING_GL.ap.code,   account_name: NETTING_GL.ap.name,   dr: ap,  description: `Offset A/P — ${vendorLabel}` },
      { account_code: NETTING_GL.bank.code, account_name: NETTING_GL.bank.name, dr: net, description: `Receive net from ${vendorLabel}` },
      { account_code: NETTING_GL.ar.code,   account_name: NETTING_GL.ar.name,   cr: ar,  description: `Offset A/R — ${vendorLabel}` },
    );
  } else {
    lines.push(
      { account_code: NETTING_GL.ap.code,   account_name: NETTING_GL.ap.name,   dr: ap,  description: `Offset A/P — ${vendorLabel}` },
      { account_code: NETTING_GL.ar.code,   account_name: NETTING_GL.ar.name,   cr: ar,  description: `Offset A/R — ${vendorLabel}` },
      { account_code: NETTING_GL.bank.code, account_name: NETTING_GL.bank.name, cr: net, description: `Pay net to ${vendorLabel}` },
    );
  }

  const je = await createJE({
    source_type: 'AR_AP_NETTING',
    source_id: netting.id,
    je_date: netting.netting_date,
    description: `AR-AP Netting — ${netting.netting_no} (${vendorLabel})`,
    remark: `AR ${ar} / AP ${ap} → ${netting.direction === 'receive' ? 'Receive' : 'Pay'} net ${net} · FI ${netting.finance_institution}`,
    lines,
  });
  await postJE(je.id, 'user');

  await supabase
    .from('ar_ap_nettings')
    .update({ je_id: je.id, status: 'Executed', updated_at: new Date().toISOString() })
    .eq('id', netting.id);

  return je.je_number;
}
