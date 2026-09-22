// =====================================================================
//  Termination Guard — กันปิด MA/CA ตอน "ลูก" ยังมีชีวิต
// =====================================================================
// MA/CA ไม่ลง JE เอง แต่เป็นสัญญาหลัก/วงเงินที่มีลูกผูกอยู่ · ปิดทิ้งทั้งที่ลูก
// ยังไม่จบ = ทิ้งวงเงิน/ธุรกรรมให้ลอย ไม่มีต้นทางอ้างอิง · จึงต้องกันไว้
//
//   • ปิด MA ไม่ได้ ถ้ายังมี CA ที่ยังไม่จบอยู่ใต้มัน
//   • ปิด CA ไม่ได้ ถ้ายังมีธุรกรรม (PN/TR/OD/FP/LG/Loan/Lease/FXF) ที่ยังไม่จบผูกอยู่
//
// เรียกตอนเปลี่ยนเป็นสถานะจบ (Terminated/Expired/Closed/Cancelled) หรือตอนขอปิดสัญญา
// =====================================================================

import { supabase } from './supabase';

// สถานะที่ถือว่า "จบแล้ว" ครอบทุกโมดูล — ลูกที่อยู่นอกชุดนี้ = ยังมีชีวิต
const ENDED = new Set([
  'Closed', 'Cancelled', 'Rejected', 'Expired', 'Terminated',
  'Settled', 'Converted', 'Repaid', 'Roll Over',
]);

// วงเงิน (CA) ใต้สัญญาหลัก — สถานะจบของ CA
const CA_ENDED = new Set(['Closed', 'Cancelled', 'Rejected', 'Expired', 'Terminated']);

// ธุรกรรมที่ผูกกับวงเงิน (CA) ผ่าน ca_id
const CA_CHILD_TABLES: [string, string][] = [
  ['promissory_notes', 'P/N'],
  ['loans', 'Loan'],
  ['letter_guarantees', 'LG/BG'],
  ['floor_plans', 'Floor Plan'],
  ['overdrafts', 'O/D'],
  ['trust_receipts', 'T/R'],
  ['fx_forwards', 'FX Forward'],
  ['leases', 'Lease'],
];

/**
 * โยน Error ถ้ายังมีลูกที่ยังไม่จบ · ไม่ทำอะไรถ้าไม่มี
 * (กรองสถานะฝั่ง client เพื่อเลี่ยงปัญหา escaping ของค่าที่มีช่องว่าง เช่น "Roll Over")
 */
export async function assertNoActiveChildren(
  module: 'MA' | 'CA',
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;

  if (module === 'MA') {
    const { data } = await supabase
      .from('credit_agreements')
      .select('ca_name, status')
      .eq('ma_id', id);
    const alive = (data ?? []).filter((r: any) => !CA_ENDED.has(r.status));
    if (alive.length > 0) {
      const sample = alive.slice(0, 3).map((r: any) => r.ca_name).filter(Boolean).join(' · ');
      throw new Error(
        `ปิดสัญญาหลักไม่ได้ — ยังมีวงเงิน (CA) ที่ยังไม่จบ ${alive.length} รายการ` +
          `${sample ? ` (${sample}${alive.length > 3 ? ' และอื่นๆ' : ''})` : ''} · ` +
          `ต้องปิด/ยกเลิกวงเงินเหล่านี้ให้จบก่อน`,
      );
    }
    return;
  }

  // CA → ตรวจทุกตารางธุรกรรมที่อ้าง ca_id
  const results = await Promise.all(
    CA_CHILD_TABLES.map(async ([tbl, label]) => {
      const { data } = await supabase.from(tbl).select('status').eq('ca_id', id);
      const alive = (data ?? []).filter((r: any) => !ENDED.has(r.status));
      return alive.length > 0 ? `${label} (${alive.length})` : null;
    }),
  );
  const labels = results.filter(Boolean) as string[];
  if (labels.length > 0) {
    throw new Error(
      `ปิดวงเงินไม่ได้ — ยังมีธุรกรรมที่ยังไม่จบผูกอยู่: ${labels.join(', ')} · ` +
        `ต้องจัดการธุรกรรมเหล่านี้ให้จบก่อน`,
    );
  }
}

// =====================================================================
//  Termination workflow (MA/CA) — ทำผ่าน dropdown ล้วน ไม่มีปุ่ม
// =====================================================================
// ผู้ใช้เลือก "Terminated" ได้ตรงๆ แต่ระบบหน่วงเป็น 2 สเต็ปให้เอง:
//   Approved + เลือก Terminated          → เก็บเป็น "Pending Termination" (ขอปิด · บันทึกคนขอ)
//   Pending Termination + เลือก Terminated → "Terminated" จริง (อนุมัติ · ต้องเป็นคนอื่นที่ไม่ใช่คนขอ)
//   Pending Termination + เลือก Approved   → ส่งกลับ · ล้างคนขอ

/**
 * แปลงค่าที่เลือกใน dropdown → สถานะจริงที่จะบันทึก
 * เลือก "Terminated" จาก Approved = การ "ขอปิด" → เก็บเป็น Pending Termination (ยังไม่ปิดจริง)
 */
export function resolveTerminationStatus(
  module: 'MA' | 'CA',
  savedStatus: string | null | undefined,
  picked: string | null | undefined,
): string {
  if ((module === 'MA' || module === 'CA') && savedStatus === 'Approved' && picked === 'Terminated') {
    return 'Pending Termination';
  }
  return picked ?? '';
}

/**
 * ตรวจการปิดสัญญา · โยน Error ถ้าไม่ผ่าน (picked = ค่าที่เลือกใน dropdown)
 *  - ขอปิด (Approved + Terminated): ลูกต้องจบก่อน
 *  - อนุมัติปิด (Pending Termination + Terminated): ห้ามคนขอมาอนุมัติเอง (ยกเว้น Admin)
 */
export async function assertTerminationTransition(
  module: 'MA' | 'CA',
  savedStatus: string | null | undefined,
  picked: string | null | undefined,
  opts: { requestedBy?: string | null; currentUser: string; isAdmin: boolean; facilityId?: string | null },
): Promise<void> {
  // ขอปิดสัญญา — ลูกต้องจบก่อนถึงจะขอได้
  if (savedStatus === 'Approved' && picked === 'Terminated') {
    await assertNoActiveChildren(module, opts.facilityId);
    return;
  }
  // อนุมัติปิด — กันคนขอเองมาอนุมัติเอง (SoD)
  if (savedStatus === 'Pending Termination' && picked === 'Terminated') {
    if (opts.requestedBy && opts.requestedBy === opts.currentUser && !opts.isAdmin) {
      throw new Error('คุณเป็นคนขอปิดสัญญานี้เอง — ต้องให้คนอื่นเป็นผู้อนุมัติการปิด');
    }
  }
}

/**
 * คอลัมน์ audit ที่ต้อง set/ล้าง ตามการปิดสัญญา — merge เข้า payload ตอน update
 */
export function terminationPayload(
  savedStatus: string | null | undefined,
  picked: string | null | undefined,
  currentUser: string,
): Record<string, unknown> {
  // ขอปิด → บันทึกคนขอ
  if (savedStatus === 'Approved' && picked === 'Terminated') {
    return { termination_requested_by: currentUser, termination_requested_at: new Date().toISOString() };
  }
  // ส่งกลับ Approved → ล้างคำขอ
  if (savedStatus === 'Pending Termination' && picked === 'Approved') {
    return { termination_requested_by: null, termination_requested_at: null };
  }
  return {};
}
