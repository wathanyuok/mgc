// =====================================================================
// กลับรายการยอดค้ำประกัน/ภาระผูกพันนอกงบ (off-balance)
//
// ตอนออกหนังสือค้ำประกันหรือเปิด L/C ระบบจะบันทึกภาระผูกพันไว้ในบัญชีนอกงบ
// (Dr ภาระผูกพัน / Cr บัญชีคู่) พอสัญญาจบต้องกลับรายการออก ไม่งั้นยอดจะค้างสะสม
//
// ปัญหาเดิม: มีการกลับรายการเฉพาะ 2 ทาง — หมดอายุอัตโนมัติ กับยกเลิกก่อนกำหนด
// แต่สัญญาจบได้อีกหลายทาง เช่น ต่ออายุ ปิดเอง ยกเลิกเอง หรือเลือกหมดอายุเองจากช่องสถานะ
// ทางเหล่านั้นไม่กลับรายการเลย โดยเฉพาะ "ต่ออายุ" ที่สร้างสัญญาใหม่ซึ่งบันทึกภาระผูกพันเพิ่มอีกชุด
// → ต่ออายุ 3 ครั้ง ยอดภาระผูกพันนอกงบก็กลายเป็น 3 เท่าของความจริง
//
// เนื่องจากเป็นคู่ Dr/Cr ที่หักล้างกันเอง งบทดลองจึงยังลงตัว ไม่มีอะไรฟ้อง —
// ตัวเลขที่ผิดจะไปโผล่ตอนเปิดเผยภาระผูกพันในหมายเหตุงบการเงินเท่านั้น
// =====================================================================
import { supabase } from './supabase';
import { createJE, postJE } from './je';

export interface OffBalanceAccounts {
  contingent: { code: string; name: string };
  contingentContra: { code: string; name: string };
}

export interface ReverseOffBalanceInput {
  /** id ของสัญญา */
  sourceId: string;
  /** source_type ของใบสำคัญตอนบันทึกภาระผูกพันครั้งแรก */
  issueSourceType: string;
  /** source_type ที่จะใช้บันทึกใบกลับรายการครั้งนี้ */
  reverseSourceType: string;
  /**
   * source_type ของใบกลับรายการ "ทุกแบบ" ที่เคยใช้
   * ต้องตรวจให้ครบ ไม่งั้นทางที่กลับรายการไปแล้วจะถูกกลับซ้ำอีกรอบ
   */
  allReverseSourceTypes: readonly string[];
  amount: number;
  jeDate: string;
  /** ชื่อสัญญาสำหรับแสดงในคำอธิบาย */
  label: string;
  /** เหตุผลที่กลับรายการ เช่น "ครบกำหนด" "ต่ออายุ" */
  reason: string;
  accounts: OffBalanceAccounts;
}

/**
 * กลับรายการภาระผูกพันนอกงบ — ทำซ้ำได้ ไม่สร้างใบซ้ำ
 * คืนเลขที่ใบสำคัญถ้าสร้างจริง · คืนค่าว่างถ้าไม่ต้องทำ (ยังไม่เคยบันทึก หรือกลับไปแล้ว)
 */
export async function reverseOffBalance(input: ReverseOffBalanceInput): Promise<string> {
  const amount = Math.round((input.amount ?? 0) * 100) / 100;
  if (!input.sourceId || amount <= 0) return '';

  // ต้องเคยบันทึกภาระผูกพันไว้ก่อน ถึงจะมีอะไรให้กลับ
  const { data: issued } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source_type', input.issueSourceType)
    .eq('source_id', input.sourceId)
    .eq('status', 'Posted');
  if (!issued || issued.length === 0) return '';

  // กลับไปแล้วหรือยัง — ตรวจทุกแบบที่เคยใช้
  const { data: reversed } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source_id', input.sourceId)
    .in('source_type', input.allReverseSourceTypes as string[]);
  if (reversed && reversed.length > 0) return '';

  const je = await createJE({
    source_type: input.reverseSourceType,
    source_id: input.sourceId,
    je_date: input.jeDate,
    description: `${input.label} — กลับรายการภาระผูกพันนอกงบ (${input.reason})`,
    remark: `กลับรายการอัตโนมัติเมื่อ${input.reason}`,
    lines: [
      {
        account_code: input.accounts.contingentContra.code,
        account_name: input.accounts.contingentContra.name,
        dr: amount,
        description: `กลับรายการบัญชีคู่ — ${input.reason}`,
      },
      {
        account_code: input.accounts.contingent.code,
        account_name: input.accounts.contingent.name,
        cr: amount,
        description: `กลับรายการภาระผูกพัน — ${input.reason}`,
      },
    ],
  });
  await postJE(je.id, 'user');
  return je.je_number;
}

// ---- LG / BG ---------------------------------------------------------
export const LG_ISSUE_SOURCE = 'LG_ISSUE_OFFBALANCE';
export const LG_REVERSE_SOURCES = [
  'LG_EXPIRE_REVERSE',      // หมดอายุตามวันที่
  'LG_TERMINATE_REVERSE',   // ยกเลิกก่อนกำหนด
  'LG_OFFBALANCE_REVERSE',  // ทางอื่น — ต่ออายุ ปิดเอง ยกเลิกเอง
] as const;

/** สถานะที่แปลว่าหนังสือค้ำประกันจบแล้ว ต้องไม่มีภาระผูกพันค้างอยู่ */
export const LG_ENDED_STATUSES = ['Expired', 'Terminated', 'Closed', 'Cancelled', 'Roll Over'];

// ---- L/C -------------------------------------------------------------
// ภาระผูกพันของ L/C ถูกบันทึกรวมอยู่ในใบสำคัญค่าธรรมเนียมแรกเข้า (LC_FEE)
// และถูกกลับรายการเมื่อแปลงเป็นทรัสต์รีซีท (LC_CONVERT) หรือจ่ายปิด (LC_SETTLE)
// แต่ถ้าผู้ใช้เลือกปิด/ยกเลิก/หมดอายุเองจากช่องสถานะ จะไม่มีอะไรกลับรายการให้
export const LC_ISSUE_SOURCE = 'LC_FEE';
export const LC_REVERSE_SOURCES = [
  'LC_CONVERT', 'LC_SETTLE', 'LC_OFFBALANCE_REVERSE',
] as const;

/** สถานะที่แปลว่า L/C จบแล้ว ต้องไม่มีภาระผูกพันค้างอยู่ */
export const LC_ENDED_STATUSES = ['Expired', 'Cancelled', 'Closed', 'Converted'];
