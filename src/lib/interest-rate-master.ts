// Interest Rate master lookup — base rate ดึงจาก Master (Interest Rate) ตาม MoM
//   "อัตราดอกเบี้ยดึงมาจากวงเงิน ... แต่แก้ไขได้ ถือว่าวงเงินเป็นตัวหลัก"
// Floating types (MLR/MOR/MRR/MMR) default their base_rate from the master,
// effective as of the rate card's start date; Fixed stays manual.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { InterestRate } from '@/types/database';

export const FLOATING_RATE_TYPES = ['MLR', 'MOR', 'MRR', 'MMR'];

/** Pure lookup: latest Active master base_rate for (institution, type) effective on/before asOf. */
export function lookupBaseRate(
  rows: InterestRate[],
  financeInstitution: string | null | undefined,
  type: string,
  asOf: string | null,
): number | null {
  if (!FLOATING_RATE_TYPES.includes(type)) return null; // Fixed → manual
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const matches = rows
    .filter(
      (r) =>
        r.status === 'Active' &&
        r.interest_type === type &&
        (!financeInstitution || r.finance_institution === financeInstitution) &&
        r.date_effective <= date &&
        (r.end_effective_date == null || r.end_effective_date >= date),
    )
    .sort((a, b) => (a.date_effective < b.date_effective ? 1 : -1)); // latest effective first
  return matches.length ? matches[0].base_rate : null;
}

/**
 * Hook returning a lookup fn `(type, startDate) => base_rate | null`.
 * Loads the Interest Rate master once (cached) and resolves against it.
 */
export function useBaseRateLookup(financeInstitution: string | null | undefined) {
  const { data: rows = [] } = useQuery({
    queryKey: ['interest-rate-master'],
    queryFn: async () => {
      const { data } = await supabase
        .from('interest_rates')
        .select('*')
        .eq('status', 'Active');
      return (data ?? []) as InterestRate[];
    },
    staleTime: 5 * 60 * 1000,
  });
  return (type: string, startDate: string | null): number | null =>
    lookupBaseRate(rows, financeInstitution, type, startDate);
}
