// Interest Rate master lookup — base rate ดึงจาก Master (Interest Rate) ตาม
// "อัตราดอกเบี้ยดึงมาจากวงเงิน ... แต่แก้ไขได้ ถือว่าวงเงินเป็นตัวหลัก"
// Floating types (MLR/MOR/MRR/MMR) default their base_rate from the master,
// effective as of the rate card's start date; Fixed stays manual.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { InterestRate } from '@/types/database';

export const FLOATING_RATE_TYPES = ['MLR', 'MOR', 'MRR', 'MMR'];

/** ค่า base rate + margin ที่ดึงจาก Interest Rate master มาเติมในการ์ดดอกเบี้ยของสัญญา.
 *  base → INTEREST RATE (%), margin → INTEREST RATE CONDITION (%) · effective = base + margin */
export interface BaseRateHit {
  base_rate: number;
  margin: number;
}

/** Pure lookup: latest Active master row for (institution, type).
 *  คืนทั้ง base_rate และ margin (เพราะ margin = INTEREST RATE CONDITION ในสัญญา).
 *  - ใช้ได้ทุกประเภทรวม Fixed (ถ้า master มีแถวให้ดึง)
 *  - ลำดับเลือก: แถวที่ยัง effective ณ วันที่ก่อน → ถ้าไม่มี ดึงแถวล่าสุดที่เริ่มแล้ว "แม้หมดอายุ (expired)"
 *    → ถ้ายังไม่มี (มีแต่ future) ดึงแถวที่จะเริ่มเร็วสุด · ดึงมาแสดงเสมอถ้ามีแถวใน master */
export function lookupBaseRate(
  rows: InterestRate[],
  financeInstitution: string | null | undefined,
  type: string,
  asOf: string | null,
): BaseRateHit | null {
  // Local-timezone-safe today (avoids UTC off-by-one when picking effective rate).
  const date = asOf ?? (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const matches = rows.filter(
    (r) =>
      r.status === 'Active' &&
      r.interest_type === type &&
      (!financeInstitution || r.finance_institution === financeInstitution),
  );
  if (!matches.length) return null;
  // 1) effective ณ วันที่ (เริ่มแล้ว + ยังไม่หมดอายุ) — เลือกวันเริ่มล่าสุด
  const onDate = matches
    .filter((r) => r.date_effective <= date && (r.end_effective_date == null || r.end_effective_date >= date))
    .sort((a, b) => (a.date_effective < b.date_effective ? 1 : -1));
  // 2) fallback: เริ่มแล้วแต่หมดอายุไปแล้ว (expired) — เลือกวันเริ่มล่าสุด
  const started = matches
    .filter((r) => r.date_effective <= date)
    .sort((a, b) => (a.date_effective < b.date_effective ? 1 : -1));
  // 3) fallback: มีแต่แถวอนาคต — เลือกที่จะเริ่มเร็วสุด
  const future = matches.slice().sort((a, b) => (a.date_effective > b.date_effective ? 1 : -1));
  const hit = onDate[0] ?? started[0] ?? future[0];
  return { base_rate: hit.base_rate, margin: hit.margin ?? 0 };
}

/**
 * Hook returning a lookup fn `(type, startDate) => { base_rate, margin } | null`.
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
  return (type: string, startDate: string | null): BaseRateHit | null =>
    lookupBaseRate(rows, financeInstitution, type, startDate);
}
