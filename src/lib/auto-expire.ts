// เปลี่ยนสถานะเป็นหมดอายุอัตโนมัติ เมื่อเลยวันสิ้นสุดแล้ว
// รันตอนเปิดแอป (ครั้งเดียวต่อ session) — prototype ใช้ client-side sweep · production ย้ายไป scheduled job ได้
//
// เดิมดูแลแค่สัญญาหลักกับวงเงิน ทั้งที่หนังสือค้ำประกันและเลตเตอร์ออฟเครดิต
// ก็มีสถานะหมดอายุอยู่แล้ว และต้องกลับรายการภาระผูกพันนอกงบตอนจบด้วย
// ถ้าเปลี่ยนสถานะเฉยๆ โดยไม่กลับรายการ ยอดภาระผูกพันนอกงบจะค้างสะสมไปเรื่อยๆ
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import {
  reverseOffBalance,
  LG_ISSUE_SOURCE, LG_REVERSE_SOURCES,
  LC_ISSUE_SOURCE, LC_REVERSE_SOURCES,
} from '@/lib/offbalance-reverse';

let ran = false;

// บัญชีนอกงบ — ต้องตรงกับที่หน้ารายละเอียดใช้ตอนบันทึกภาระผูกพัน
const LG_GL = {
  contingent: { code: '900100', name: 'Contingent Liability — LG/BG (Off-Balance)' },
  contingentContra: { code: '900200', name: 'Contra — LG/BG Commitment' },
};
const LC_GL = {
  contingent: { code: '900100', name: 'Contingent Liability — L/C (Off-Balance)' },
  contingentContra: { code: '900200', name: 'Contra — L/C Commitment' },
};

/** วันที่ตามเครื่องผู้ใช้ — ห้ามใช้ toISOString() เพราะช่วงเช้ามืดจะได้วันที่ย้อนไป 1 วัน */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * สัญญาหลัก / วงเงิน — เปลี่ยนสถานะเป็นหมดอายุ
 *
 * ต้องขอแถวที่ถูกแก้กลับมาด้วย (`select`) ไม่งั้นจะไม่รู้เลยว่าทำงานได้จริงไหม
 * เดิมสั่ง update เฉยๆ แล้วไม่ได้อ่านค่า error ที่ฐานข้อมูลส่งกลับ — ถ้าถูกปฏิเสธ
 * จะเงียบสนิท ไม่มีอะไรขึ้นทั้งบนจอและใน console ทำให้หาสาเหตุไม่เจอ
 */
async function expireByEndDate(
  table: 'master_agreements' | 'credit_agreements',
  today: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .update({ status: 'Expired' })
    .eq('status', 'Approved')
    .lt('end_date', today)
    .select('id');
  if (error) {
    console.error(`[หมดอายุอัตโนมัติ] ${table} เปลี่ยนสถานะไม่สำเร็จ:`, error.message, error);
    return 0;
  }
  return data?.length ?? 0;
}

/** หนังสือค้ำประกัน / เลตเตอร์ออฟเครดิต — กลับรายการนอกงบก่อน แล้วค่อยเปลี่ยนสถานะ */
async function expireOffBalanceDoc(
  table: 'letter_guarantees' | 'letters_of_credit',
  noCol: 'lg_no' | 'lc_no',
  today: string,
  reverse: (row: any) => Promise<unknown>,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .select(`id, name, ${noCol}, amount, expiry_date`)
    .in('status', ['Approved', 'Active'])
    .lt('expiry_date', today);
  if (error) {
    console.error(`[หมดอายุอัตโนมัติ] ${table} อ่านรายการไม่สำเร็จ:`, error.message, error);
    return 0;
  }
  if (!data || data.length === 0) return 0;

  for (const row of data as any[]) {
    try {
      await reverse(row);
    } catch (e) {
      console.warn('[หมดอายุอัตโนมัติ] กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
    }
  }
  const { error: upErr } = await supabase.from(table).update({ status: 'Expired' })
    .in('id', (data as any[]).map((r) => r.id));
  if (upErr) {
    console.error(`[หมดอายุอัตโนมัติ] ${table} เปลี่ยนสถานะไม่สำเร็จ:`, upErr.message, upErr);
    return 0;
  }
  return data.length;
}

export async function runAutoExpire(): Promise<void> {
  if (ran) return;
  ran = true;
  const today = localToday();
  try {
    const [ma, ca, lg, lc] = await Promise.all([
      expireByEndDate('master_agreements', today),
      expireByEndDate('credit_agreements', today),
      expireOffBalanceDoc('letter_guarantees', 'lg_no', today, (row) =>
        reverseOffBalance({
          sourceId: row.id,
          issueSourceType: LG_ISSUE_SOURCE,
          reverseSourceType: 'LG_EXPIRE_REVERSE',
          allReverseSourceTypes: LG_REVERSE_SOURCES,
          amount: row.amount ?? 0,
          jeDate: today,
          label: row.name ?? row.lg_no,
          reason: `ครบกำหนด (วันสิ้นสุด ${row.expiry_date})`,
          accounts: LG_GL,
        })),
      expireOffBalanceDoc('letters_of_credit', 'lc_no', today, (row) =>
        reverseOffBalance({
          sourceId: row.id,
          issueSourceType: LC_ISSUE_SOURCE,
          reverseSourceType: 'LC_OFFBALANCE_REVERSE',
          allReverseSourceTypes: LC_REVERSE_SOURCES,
          amount: row.amount ?? 0,
          jeDate: row.expiry_date ?? today,
          label: row.name ?? row.lc_no,
          reason: `ครบกำหนด (วันสิ้นสุด ${row.expiry_date})`,
          accounts: LC_GL,
        })),
    ]);

    const total = ma + ca + lg + lc;
    if (total === 0) return;

    // หน้ารายการมักโหลดข้อมูลเสร็จก่อนที่คำสั่งนี้จะทำงานจบ (ยิงพร้อมกันตอนเปิดแอป)
    // ถ้าไม่สั่งให้โหลดใหม่ ผู้ใช้จะเห็นสถานะเดิมค้างอยู่ ทั้งที่ฐานข้อมูลเปลี่ยนไปแล้ว
    // — นี่คือเหตุผลที่เดิม "เปลี่ยนแล้วแต่บนจอไม่เปลี่ยน"
    await queryClient.invalidateQueries();

    const parts = [
      ma && `สัญญาหลัก ${ma}`,
      ca && `วงเงิน ${ca}`,
      lg && `หนังสือค้ำประกัน ${lg}`,
      lc && `เลตเตอร์ออฟเครดิต ${lc}`,
    ].filter(Boolean).join(' · ');
    toast.info(`เปลี่ยนสถานะเป็นหมดอายุให้อัตโนมัติ — ${parts}`, {
      description: 'เลยวันสิ้นสุดแล้ว ระบบปรับให้ตอนเปิดหน้าเว็บ',
      duration: 8000,
    });
  } catch (e) {
    console.error('[หมดอายุอัตโนมัติ] ทำงานไม่สำเร็จ:', e);
  }
}
