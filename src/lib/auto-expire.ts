// เปลี่ยนสถานะเป็นหมดอายุอัตโนมัติ เมื่อเลยวันสิ้นสุดแล้ว
// รันตอนเปิดแอป (ครั้งเดียวต่อ session) — prototype ใช้ client-side sweep · production ย้ายไป scheduled job ได้
//
// เดิมดูแลแค่สัญญาหลักกับวงเงิน ทั้งที่หนังสือค้ำประกันและเลตเตอร์ออฟเครดิต
// ก็มีสถานะหมดอายุอยู่แล้ว และต้องกลับรายการภาระผูกพันนอกงบตอนจบด้วย
// ถ้าเปลี่ยนสถานะเฉยๆ โดยไม่กลับรายการ ยอดภาระผูกพันนอกงบจะค้างสะสมไปเรื่อยๆ
import { supabase } from '@/lib/supabase';
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

/** หนังสือค้ำประกัน / เลตเตอร์ออฟเครดิต — กลับรายการนอกงบก่อน แล้วค่อยเปลี่ยนสถานะ */
async function expireOffBalanceDoc(
  table: 'letter_guarantees' | 'letters_of_credit',
  noCol: 'lg_no' | 'lc_no',
  today: string,
  reverse: (row: any) => Promise<unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select(`id, name, ${noCol}, amount, expiry_date`)
    .in('status', ['Approved', 'Active'])
    .lt('expiry_date', today);
  if (error || !data || data.length === 0) return;

  for (const row of data as any[]) {
    try {
      await reverse(row);
    } catch (e) {
      console.warn('[auto-expire] กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
    }
  }
  await supabase.from(table).update({ status: 'Expired' })
    .in('id', (data as any[]).map((r) => r.id));
}

export async function runAutoExpire(): Promise<void> {
  if (ran) return;
  ran = true;
  const today = localToday();
  try {
    await Promise.all([
      supabase.from('master_agreements')
        .update({ status: 'Expired' })
        .eq('status', 'Approved')
        .lt('end_date', today),
      supabase.from('credit_agreements')
        .update({ status: 'Expired' })
        .eq('status', 'Approved')
        .lt('end_date', today),
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
  } catch (e) {
    console.warn('[auto-expire]', e); // เงียบ — ไม่ block การใช้งาน
  }
}
