// กันสินทรัพย์ซ้ำสำหรับ Leasing Other (NetSuite Fixed Asset — อาคาร/ที่ดิน/เครื่องจักร ไม่มีเลขตัวถัง)
//
// Leasing (รถ) กันซ้ำด้วย CHASSIS NO แล้ว (chassis conflict) · แต่ Leasing Other ใช้ ASSET NAME จาก
// NetSuite FA ซึ่งยังไม่มีตัวกันซ้ำ — สินทรัพย์ชิ้นเดียวเช่าซ้อน 2 สัญญาที่ยังเปิดพร้อมกันไม่ได้
//
// ตัว asset_no ของ NetSuite ยังไม่ถูกเก็บลงคอลัมน์ (เป็นแค่ UI state) จึงเทียบด้วย asset_name ที่ persist จริง
// สถานะ: Active/Approved = มีผลแล้ว → บล็อก · Draft/รออนุมัติ → เตือน (จองล่วงหน้าได้) — pattern เดียวกับ chassis
import { supabase } from './supabase';
import { isChassisHolderOpen, isCommittedHolder } from './chassis-overlap';

export interface LeaseAssetConflict {
  lease_no: string;
  status: string;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** หา Leasing Other สัญญาอื่นที่ใช้ ASSET NAME เดียวกันและยังเปิดอยู่ (ไม่รวมสัญญาที่กำลังแก้) */
export async function checkLeaseOtherAssetConflict(
  assetName: string | null | undefined,
  excludeId?: string | null,
): Promise<LeaseAssetConflict[]> {
  const key = norm(assetName);
  if (!key) return [];
  const { data, error } = await supabase
    .from('leases')
    .select('id, lease_no, status, asset_name')
    .eq('mode', 'other');
  if (error) {
    console.warn('[LeaseOther asset conflict] error:', error.message);
    return [];
  }
  return (data ?? [])
    .filter((r: any) =>
      r.id !== excludeId &&
      norm(r.asset_name) === key &&
      isChassisHolderOpen(r.status),
    )
    .map((r: any) => ({ lease_no: r.lease_no, status: r.status }));
}

/** แยกระดับ: Active/Approved = บล็อก · Draft/รออนุมัติ = เตือน */
export function classifyLeaseAssetConflicts(conflicts: LeaseAssetConflict[]): {
  blockers: LeaseAssetConflict[];
  warnings: LeaseAssetConflict[];
} {
  return {
    blockers: conflicts.filter((c) => isCommittedHolder(c.status)),
    warnings: conflicts.filter((c) => !isCommittedHolder(c.status)),
  };
}
