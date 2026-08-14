// Auto-Expire — MA/CA ที่อนุมัติแล้วแต่เลยวันสิ้นสุดสัญญา → เปลี่ยนเป็น Expired อัตโนมัติ
// รันตอนเปิดแอป (ครั้งเดียวต่อ session) — prototype ใช้ client-side sweep · production ย้ายไป scheduled job ได้
import { supabase } from '@/lib/supabase';

let ran = false;

export async function runAutoExpire(): Promise<void> {
  if (ran) return;
  ran = true;
  const today = new Date().toISOString().slice(0, 10);
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
    ]);
  } catch (e) {
    console.warn('[auto-expire]', e); // เงียบ — ไม่ block การใช้งาน
  }
}
