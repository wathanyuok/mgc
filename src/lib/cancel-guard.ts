// =====================================================================
//  Cancel Guard — กติกากลาง "ยกเลิกสัญญา (Cancelled) ได้เมื่อไร"
// =====================================================================
// ใช้ร่วมกันทุกโมดูล (PN / TR / OD / FP / LG / LC / FXF / Loan / Lease / MA / CA)
// เรียกใน save mutation ตรงจุดเดียวกับ canSaveStatusChange
//
//   await assertCancelAllowed('TR', savedStatus, nextStatus, id);
//
// ตรรกะ 3 ชั้น (ตามที่ตกลงไว้):
//   1) จบแล้ว (terminal เช่น Closed/Expired/Terminated/Settled/Converted/Roll Over)
//        → ยกเลิกไม่ได้ · ต้องปรับสถานะกลับก่อน (Cancelled เองก็ terminal)
//   2) ยังมีผล (Approved/Active/Suspended/Modified/Pending*) แต่ "มีกิจกรรมบัญชีจริง"
//        คือมีใบสำคัญที่ Posted หรือมีการชำระที่ Posted → ยกเลิกไม่ได้
//        ให้กลับรายการใบสำคัญก่อน หรือใช้ "ปิดสัญญา" แทน
//   3) ยังไม่มีกิจกรรมบัญชี (ยังไม่ post JE · ยังไม่ชำระ) → ยกเลิกได้
//
// หลักการ: ดูที่ "มีเงินเดินจริงหรือยัง" ไม่ใช่ดูที่สถานะ — Active ที่ยังไม่ post JE ก็ยกเลิกได้
// =====================================================================

import { supabase } from './supabase';
import { computeStatusLock, moduleLabel, type ModuleKey } from './status-lock';

/**
 * ตอนกด Save เพื่อ "ยกเลิก" (เปลี่ยนสถานะเป็น Cancelled) ให้ข้ามการเช็คช่องบังคับ
 *
 * เดิม Save วิ่ง checkRequiredFields() ก่อนเสมอ — จะยกเลิกทั้งใบก็ยังโดนบังคับให้กรอก
 * วงเงิน/ช่องจำเป็นให้ครบก่อน ทั้งที่กำลังจะทิ้งรายการนี้อยู่แล้ว
 * เมื่อเป็นการยกเลิก ให้ข้ามด่านนี้ แล้วปล่อยให้ assertCancelAllowed เป็นคนตัดสินแทน
 *
 * ใช้ที่ปุ่ม Save:  if (skipRequiredForCancel(nextStatus) || checkRequiredFields()) save.mutate();
 */
export function skipRequiredForCancel(nextStatus: string | null | undefined): boolean {
  return nextStatus === 'Cancelled';
}

/**
 * โยน Error ถ้ายกเลิก (เปลี่ยนสถานะเป็น Cancelled) ไม่ได้ · ไม่ทำอะไรถ้าอนุญาต
 *
 * ทำงานเฉพาะตอน "เปลี่ยนเข้าเป็น Cancelled" เท่านั้น — สถานะปลายทางอื่นผ่านทันที
 * จึงเสียบได้ทุก save mutation โดยไม่กระทบ flow ปกติ
 */
export async function assertCancelAllowed(
  module: ModuleKey,
  savedStatus: string | null | undefined,
  nextStatus: string | null | undefined,
  facilityId: string | null | undefined,
): Promise<void> {
  // ไม่ใช่การยกเลิก หรือยกเลิกอยู่แล้ว → ไม่เกี่ยว
  if (nextStatus !== 'Cancelled' || savedStatus === 'Cancelled') return;

  const label = moduleLabel(module);
  const s = savedStatus ?? '';

  // ── ชั้น 1: จบแล้ว → ยกเลิกไม่ได้ ต้อง revert ก่อน ──────────────────
  if (computeStatusLock(module, s).isTerminal) {
    throw new Error(
      `${label} นี้จบแล้ว (${s}) — ยกเลิกไม่ได้ · ถ้าต้องการแก้ไขให้ปรับสถานะกลับก่อน`,
    );
  }

  // ยังเป็นรายการใหม่ที่ยังไม่บันทึกลงฐาน → ไม่มีบัญชีให้ห่วง
  if (!facilityId) return;

  // ── ชั้น 2: มีกิจกรรมบัญชีจริง (JE Posted / การชำระ Posted) → ยกเลิกไม่ได้ ──
  const [je, rp] = await Promise.all([
    // ใบสำคัญที่ลงบัญชีแล้วและไม่ใช่ใบกลับรายการ — source_id ผูกกับสัญญานี้
    supabase
      .from('journal_entries')
      .select('je_number', { count: 'exact' })
      .eq('source_id', facilityId)
      .eq('status', 'Posted')
      .eq('is_reversal', false)
      .limit(1),
    // การชำระที่บันทึกแล้ว (Posted) ของสัญญานี้
    supabase
      .from('repayments')
      .select('repayment_no', { count: 'exact' })
      .eq('facility_id', facilityId)
      .eq('status', 'Posted')
      .limit(1),
  ]);

  const jeCount = je.count ?? 0;
  const rpCount = rp.count ?? 0;
  if (jeCount > 0 || rpCount > 0) {
    const parts: string[] = [];
    if (jeCount > 0) {
      const jeNo = je.data?.[0]?.je_number;
      parts.push(`ใบสำคัญที่ลงบัญชีแล้ว${jeNo ? ` (${jeNo})` : ''}`);
    }
    if (rpCount > 0) parts.push('การชำระที่บันทึกแล้ว');
    throw new Error(
      `${label} นี้มี${parts.join(' และ ')} — ยกเลิกไม่ได้ · ` +
        `ให้กลับรายการใบสำคัญก่อน หรือใช้ "ปิดสัญญา" แทนการยกเลิก`,
    );
  }
}
