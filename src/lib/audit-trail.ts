// Audit Trail helper — log user actions. Best-effort (silent if table not migrated).
import { supabase } from './supabase';

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'post_je' | 'reverse_je' | 'void_je'
  | 'sync_netsuite' | 'eod_sync_run'
  | 'approve' | 'reject'
  | 'login' | 'logout';

export interface LogAuditOpts {
  action: AuditAction;
  table: string;        // 'loans' | 'leases' | 'journal_entries' | ...
  recordId?: string | null;
  recordLabel?: string | null;
  summary?: string | null;
  before?: any;
  after?: any;
}

/**
 * ชื่อผู้ใช้ที่กำลังทำรายการ
 * อ่านจากผู้ใช้ในระบบก่อน (ตาราง app_users) ถ้าไม่มีค่อยตกไปใช้บัญชีที่ล็อกอิน
 * เดิมอ่านจากบัญชีล็อกอินอย่างเดียว ทำให้ช่องผู้ใช้ในหน้าประวัติว่างทุกแถว
 */
async function currentUser(): Promise<{ id: string | null; email: string | null }> {
  try {
    const { useAuthStore } = await import('@/stores/useAuthStore');
    const s: any = useAuthStore.getState();
    const label = s.user?.name || s.user?.email || s.session?.user?.email || null;
    if (label) return { id: s.user?.id ?? s.session?.user?.id ?? null, email: label };
  } catch { /* ยังไม่พร้อม — ตกไปใช้บัญชีที่ล็อกอิน */ }
  const { data: u } = await supabase.auth.getUser();
  return { id: u?.user?.id ?? null, email: u?.user?.email ?? null };
}

export async function logAudit(opts: LogAuditOpts): Promise<void> {
  try {
    const who = await currentUser();
    await supabase.from('audit_trail').insert({
      user_id: who.id,
      user_email: who.email,
      action: opts.action,
      table_name: opts.table,
      record_id: opts.recordId ?? null,
      record_label: opts.recordLabel ?? null,
      summary: opts.summary ?? null,
      before_data: opts.before ?? null,
      after_data: opts.after ?? null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  } catch (e) {
    // Silent: audit log is best-effort; never fail the user action because of it
    console.warn('[audit_trail] log skipped:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// ตัวช่วยเรียกใช้จากหน้าจอ — เขียนสั้น ไม่ต้องจำรูปแบบ
// ─────────────────────────────────────────────────────────────

/** ชื่อโมดูลภาษาคน สำหรับแสดงในหน้าประวัติการใช้งาน */
const MODULE_LABEL: Record<string, string> = {
  master_agreements: 'สัญญาวงเงิน',
  credit_agreements: 'วงเงินสินเชื่อ',
  promissory_notes: 'ตั๋วสัญญาใช้เงิน',
  letter_guarantees: 'หนังสือค้ำประกัน',
  letters_of_credit: 'เลตเตอร์ออฟเครดิต',
  floor_plans: 'สินเชื่อรถในสต๊อก',
  overdrafts: 'วงเงินเบิกเกินบัญชี',
  trust_receipts: 'ทรัสต์รีซีท',
  fx_forwards: 'สัญญาซื้อขายเงินตราล่วงหน้า',
  loans: 'สินเชื่อ',
  leases: 'สัญญาเช่า',
  repayments: 'การรับชำระ',
  interest_rates: 'อัตราดอกเบี้ย',
  curtailments: 'ขั้นการคืนเงินต้น',
  bank_statements: 'รายการเดินบัญชี',
  gl_accounts: 'ผังบัญชี',
  app_users: 'ผู้ใช้',
  permission_groups: 'กลุ่มสิทธิ์',
};

export function moduleLabel(table: string): string {
  return MODULE_LABEL[table] ?? table;
}

/**
 * บันทึกการสร้าง/แก้ไขรายการ — เรียกหลังบันทึกสำเร็จ
 * isNew = true → นับเป็นการสร้างใหม่ · false → การแก้ไข
 */
export function logSave(
  table: string,
  id: string | null | undefined,
  label: string | null | undefined,
  isNew: boolean,
  after?: any,
): void {
  void logAudit({
    action: isNew ? 'create' : 'update',
    table,
    recordId: id ?? null,
    recordLabel: label || null,
    summary: `${isNew ? 'สร้าง' : 'แก้ไข'}${moduleLabel(table)}${label ? ` ${label}` : ''}`,
    after,
  });
}

/** บันทึกการลบรายการ — เรียกหลังลบสำเร็จ */
export function logDelete(
  table: string,
  id: string | null | undefined,
  label?: string | null,
  before?: any,
): void {
  void logAudit({
    action: 'delete',
    table,
    recordId: id ?? null,
    recordLabel: label || null,
    summary: `ลบ${moduleLabel(table)}${label ? ` ${label}` : ''}`,
    before,
  });
}
