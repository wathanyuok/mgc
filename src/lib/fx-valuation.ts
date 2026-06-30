// FX Forward Monthly Mark-to-Market (Valuation) — Feature B3
// MoM §13 #8 — ณ สิ้นเดือน MGC ต้อง revalue FX Forward ที่ยัง Active เพื่อ post
// Unrealized FX Gain/Loss เข้า GL
//
// MTM (THB) = notional × (month_end_rate − contract_rate)

import { supabase } from './supabase';
import { createJE, postJE } from './je';
import type { FXForward, FXValuation } from '@/types/database';

/** GL accounts for FX Valuation JEs (TFRS 9 — derivative MTM) */
export const FX_VALUATION_GL = {
  fxfAsset:   { code: '119500', name: 'Derivative Asset — FX Forward (MTM)' },
  fxfLiab:    { code: '219500', name: 'Derivative Liability — FX Forward (MTM)' },
  fxGainUnreal: { code: '710020', name: 'Unrealized FX Gain' },
  fxLossUnreal: { code: '610020', name: 'Unrealized FX Loss' },
};

export interface MTMResult {
  notional_thb: number;
  mtm_thb: number;
}

/**
 * Compute MTM for one FX Forward at a given month-end spot rate.
 *
 * notional_thb = notional × contract_rate (booked carrying amount)
 * mtm_thb      = notional × (month_end_rate − contract_rate)
 *              + → Unrealized Gain   (− → Loss)
 *
 * Note: this assumes a "Buy foreign / Sell THB" stance — i.e. MGC is long
 * the foreign currency. For "Sell foreign", the sign should be inverted
 * by the caller (direction is on the fxf row).
 */
export function computeMTM(
  fxf: Pick<FXForward, 'notional_amount_foreign' | 'amount_buy' | 'forward_rate' | 'direction'>,
  monthEndRate: number,
  _valuationDate: string,
): MTMResult {
  const notional = Number(fxf.notional_amount_foreign ?? fxf.amount_buy ?? 0);
  const contractRate = Number(fxf.forward_rate ?? 0);
  const monthEnd = Number(monthEndRate ?? 0);

  const notional_thb = round2(notional * contractRate);
  let mtm_thb = round2(notional * (monthEnd - contractRate));
  // Sell-direction inverts P&L
  if (fxf.direction === 'Sell') mtm_thb = -mtm_thb;
  return { notional_thb, mtm_thb };
}

/** Find FX Forwards eligible for valuation on `asOfDate` (Active + not yet settled). */
export async function findActiveForValuation(asOfDate: string): Promise<FXForward[]> {
  const { data, error } = await supabase
    .from('fx_forwards')
    .select('*')
    .eq('status', 'Active')
    .gte('value_date', asOfDate)
    .order('fxf_no');
  if (error) throw error;
  return (data ?? []) as FXForward[];
}

/**
 * Create a Posted JE for one FX Valuation row, then link it back.
 * Caller passes a `valuation` row that's already inserted (status='Draft').
 *
 * JE:
 *   if mtm > 0  → Dr Derivative Asset / Cr Unrealized FX Gain
 *   if mtm < 0  → Dr Unrealized FX Loss / Cr Derivative Liability
 *   if mtm ≈ 0  → no JE created (returns null)
 */
export async function postFXValuationJE(
  valuation: FXValuation,
  fxfNo: string,
): Promise<string | null> {
  const amt = Math.abs(round2(valuation.mtm_thb));
  if (amt < 0.005) return null;

  const isGain = valuation.mtm_thb > 0;
  const lines = isGain
    ? [
        { account_code: FX_VALUATION_GL.fxfAsset.code,     account_name: FX_VALUATION_GL.fxfAsset.name,     dr: amt, description: `MTM Asset — ${fxfNo} @ ${valuation.month_end_rate}` },
        { account_code: FX_VALUATION_GL.fxGainUnreal.code, account_name: FX_VALUATION_GL.fxGainUnreal.name, cr: amt, description: `Unrealized FX Gain — ${fxfNo}` },
      ]
    : [
        { account_code: FX_VALUATION_GL.fxLossUnreal.code, account_name: FX_VALUATION_GL.fxLossUnreal.name, dr: amt, description: `Unrealized FX Loss — ${fxfNo}` },
        { account_code: FX_VALUATION_GL.fxfLiab.code,      account_name: FX_VALUATION_GL.fxfLiab.name,      cr: amt, description: `MTM Liability — ${fxfNo} @ ${valuation.month_end_rate}` },
      ];

  const je = await createJE({
    source_type: 'FX_VALUATION',
    source_id: valuation.id,
    je_date: valuation.valuation_date,
    description: `FX Forward Valuation — ${fxfNo} (${valuation.valuation_date})`,
    remark: `MTM ${isGain ? 'Gain' : 'Loss'} ${amt.toFixed(2)} · notional ${valuation.notional_amount} × (${valuation.month_end_rate} − ${valuation.contract_rate})`,
    lines,
  });
  await postJE(je.id, 'user');

  await supabase
    .from('fx_valuations')
    .update({ je_id: je.id, status: 'Posted', updated_at: new Date().toISOString() })
    .eq('id', valuation.id);

  return je.je_number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
