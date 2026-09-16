// Segment Inheritance Helper
// ดึง Subsidiary / RPT / Class จาก parent chain (MA / CA) สำหรับแสดงเป็น "inherited" ใน Transaction
//
// Chain:
//   • Loan / PN / FP / OD / TR / LC / LG / FXF  → facility.ca_id → CA → MA
//   • Lease / HP                                 → lease.ma_id → MA (direct)

import { supabase } from './supabase';

export interface InheritedSegments {
  subsidiary?: { id: string; code: string; name: string };
  klass?: { id: string; code: string; name: string };
  rpt?: 'External' | 'In-group' | 'Other';
  finance_institution?: string;  // text (e.g., "KBANK", "SCB")
}

/** Fetch inherited segments for Loan/PN/FP/OD/TR/LC/LG/FXF (via ca_id) */
export async function fetchInheritedFromCA(caId: string | null | undefined): Promise<InheritedSegments> {
  if (!caId) return {};
  // Subsidiary ต้องมาจากตัว CA (วงเงินที่เลือก) ไม่ใช่ MA
  // — MA ใบเดียวจัดสรรได้หลายบริษัท (ma_subsidiaries) เช่น MCR + MAG
  //   แต่ละ CA เจาะจงบริษัทเดียว (credit_agreements.subsidiary)
  //   ถ้าอ่านจาก master_agreements.subsidiary ทุก CA ใต้ MA เดียวกันจะได้บริษัทเดียวกันหมด = ผิด
  //   (subsidiaryOfCa ที่ใช้คุม scope ก็อ่านจาก credit_agreements.subsidiary เช่นกัน)
  const { data } = await supabase
    .from('credit_agreements')
    .select('subsidiary, class_id, classes(id, code, name), ma_id, master_agreements(finance_institution)')
    .eq('id', caId)
    .maybeSingle();
  if (!data) return {};
  const ma: any = (data as any).master_agreements;
  const klass: any = (data as any).classes;
  const caSubsidiary: string | null = (data as any).subsidiary ?? null;
  return {
    subsidiary: caSubsidiary ? { id: '', code: '', name: caSubsidiary } : undefined,
    klass: klass ? { id: klass.id, code: klass.code, name: klass.name } : undefined,
    finance_institution: ma?.finance_institution ?? undefined,
  };
}

/** Fetch inherited segments for Lease/HP (via ma_id direct) */
export async function fetchInheritedFromMA(maId: string | null | undefined): Promise<InheritedSegments> {
  if (!maId) return {};
  const { data } = await supabase
    .from('master_agreements')
    .select('subsidiary, finance_institution')
    .eq('id', maId)
    .maybeSingle();
  if (!data) return {};
  return {
    subsidiary: data.subsidiary ? { id: '', code: '', name: data.subsidiary } : undefined,
    finance_institution: data.finance_institution ?? undefined,
  };
}
