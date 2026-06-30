// Fixed Asset Transfer — Feature B6 (Option A: Suspense → Asset)
//
// Workshop (3.txt §575-580): drawdown แรกลง บัญชีพัก (Vehicle Suspense),
// พอรับรถจริง user กดปุ่ม "รับรถ — โอนเข้า Fixed Asset" → ระบบ post JE:
//   Dr Vehicle Asset           xx
//     Cr Vehicle Suspense        xx
//
// Status table: fa_transfers (Migration 0057).
// JE source_type='FA_TRANSFER', source_id = fa_transfers.id

import { supabase } from './supabase';
import { createJE, postJE } from './je';

export const FA_TRANSFER_GL = {
  vehicleAsset:    { code: '151000', name: 'Vehicle — Fixed Asset' },
  vehicleSuspense: { code: '198500', name: 'Vehicle Suspense (รอรับรถ)' },
};

export type FaFacilityType = 'floor_plan' | 'lease';

export interface FaTransferInput {
  facility_type: FaFacilityType;
  facility_id: string;
  chassis_id?: string | null;
  chassis_no?: string | null;
  transferred_amount: number;
  transfer_date?: string;
  remark?: string;
}

export interface FaTransferRow {
  id: string;
  facility_type: FaFacilityType;
  facility_id: string;
  chassis_id: string | null;
  chassis_no: string | null;
  transferred_amount: number;
  transfer_date: string;
  status: 'Posted' | 'Reversed';
  je_id: string | null;
  remark: string | null;
}

/**
 * Record a FA transfer + post the matching Suspense→Asset JE.
 * Returns the inserted fa_transfers row (with je_id populated).
 */
export async function postFATransfer(input: FaTransferInput): Promise<FaTransferRow> {
  const amt = Number(input.transferred_amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('transferred_amount must be a positive number');
  }
  const transferDate = input.transfer_date ?? new Date().toISOString().slice(0, 10);

  // 1. Insert transfer row (status temporarily 'Posted'; je_id filled after JE created)
  const { data: row, error } = await supabase
    .from('fa_transfers')
    .insert({
      facility_type: input.facility_type,
      facility_id: input.facility_id,
      chassis_id: input.chassis_id ?? null,
      chassis_no: input.chassis_no ?? null,
      transferred_amount: amt,
      transfer_date: transferDate,
      status: 'Posted',
      remark: input.remark ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  if (!row) throw new Error('insert fa_transfers returned no row');

  // 2. Build + post JE
  const desc = `Transfer to Fixed Asset — ${input.chassis_no ?? 'no chassis'} (${input.facility_type})`;
  const je = await createJE({
    source_type: 'FA_TRANSFER',
    source_id: row.id,
    je_date: transferDate,
    description: desc,
    remark: `FA transfer ${amt.toFixed(2)} · ${input.facility_type}/${input.facility_id.slice(0, 8)}`,
    lines: [
      {
        account_code: FA_TRANSFER_GL.vehicleAsset.code,
        account_name: FA_TRANSFER_GL.vehicleAsset.name,
        dr: amt,
        description: desc,
      },
      {
        account_code: FA_TRANSFER_GL.vehicleSuspense.code,
        account_name: FA_TRANSFER_GL.vehicleSuspense.name,
        cr: amt,
        description: 'Release from suspense',
      },
    ],
  });
  await postJE(je.id, 'user');

  // 3. Link JE back into fa_transfers row
  await supabase
    .from('fa_transfers')
    .update({ je_id: je.id, updated_at: new Date().toISOString() })
    .eq('id', row.id);

  return { ...(row as any), je_id: je.id };
}

/** List transfers for a facility (used by the FA Transfer tab). */
export async function listFATransfers(
  facility_type: FaFacilityType,
  facility_id: string,
): Promise<FaTransferRow[]> {
  const { data, error } = await supabase
    .from('fa_transfers')
    .select('*')
    .eq('facility_type', facility_type)
    .eq('facility_id', facility_id)
    .order('transfer_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FaTransferRow[];
}
