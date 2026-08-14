// Bank Master — สถาบันการเงินจาก Vendor Master (vendor_type = 'bank', Migration 0046/0048)
// ใช้ชื่อย่อ (code ตัด prefix "BANK-") ทุกที่ · เพิ่มธนาคารใหม่ = เพิ่มใน vendors ไม่ต้องแก้โค้ด
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FINANCE_INSTITUTIONS } from '@/types/database';

export async function fetchBankCodes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('code')
    .eq('vendor_type', 'bank')
    .eq('active', true)
    .order('code');
  if (error || !data?.length) return [...FINANCE_INSTITUTIONS];
  return data.map((r: any) => String(r.code).replace(/^BANK-/, ''));
}

/** Hook — ชื่อย่อธนาคารจาก Vendor Master (fallback เป็น list เดิมถ้าอ่านไม่ได้) */
export function useBankCodes(): { codes: string[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['bank-codes'],
    queryFn: fetchBankCodes,
    staleTime: 5 * 60 * 1000,
  });
  return { codes: data ?? [...FINANCE_INSTITUTIONS], loading: isLoading };
}
