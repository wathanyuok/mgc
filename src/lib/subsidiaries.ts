// Subsidiary Master — บริษัทในเครือตามผังองค์กร (Migration 0084)
// ใช้ร่วม: dropdown MA/CA · Import Migration validator/importer · เก็บค่าเป็น "code" (ชื่อย่อ) ทุกที่
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Fallback ตามผังองค์กร — ใช้เมื่อยังอ่าน master ไม่ได้ (เช่น ยังไม่รัน migration) */
export const SUBSIDIARY_CODES_FALLBACK = [
  'MGC', 'i24', 'NEO', 'ZMP', 'XMT', 'XMP', 'MGT', 'MAG', 'MCR', 'MDS',
  'SHA', 'MMS', 'USM', 'GW', 'AZM', 'MAC',
] as const;

export interface SubsidiaryRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export async function fetchSubsidiaryCodes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('subsidiaries')
    .select('code')
    .eq('active', true)
    .order('code');
  if (error || !data?.length) return [...SUBSIDIARY_CODES_FALLBACK];
  return data.map((r: any) => r.code as string);
}

/** Hook — รายชื่อย่อบริษัทจาก master (fallback เป็นชุดตามผังถ้าอ่านไม่ได้) */
export function useSubsidiaryCodes(): { codes: string[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['subsidiary-codes'],
    queryFn: fetchSubsidiaryCodes,
    staleTime: 5 * 60 * 1000,
  });
  return { codes: data ?? [...SUBSIDIARY_CODES_FALLBACK], loading: isLoading };
}
