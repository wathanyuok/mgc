// Vendor names — ดึงจาก Vendor Master (dealer/supplier) ให้ FP + Curtailment ใช้ "แหล่งเดียวกัน"
// กัน Curtailment จับคู่พลาดจากชื่อไม่ตรงกัน · รายชื่อจริงจะมาจาก NetSuite (แค่ update ตาราง ไม่แตะโค้ด)
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { VENDORS } from '@/types/database';

export async function fetchDealerVendorNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('name')
    .in('vendor_type', ['dealer', 'supplier'])
    .eq('active', true)
    .order('name');
  if (error || !data?.length) return [...VENDORS];
  return data.map((r: any) => r.name as string);
}

/** Hook — รายชื่อ vendor (dealer/supplier) จาก master · fallback = list เดิมถ้าอ่านไม่ได้ */
export function useDealerVendorNames(): { names: string[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['dealer-vendor-names'],
    queryFn: fetchDealerVendorNames,
    staleTime: 5 * 60 * 1000,
  });
  return { names: data ?? [...VENDORS], loading: isLoading };
}
