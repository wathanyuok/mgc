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
  // ใช้ชื่อเมนูหลักบนแถบเมนูซ้ายเท่านั้น — ไม่แตกเป็นเมนูย่อย
  // ตารางที่เป็นส่วนประกอบของเมนูใด ให้ยุบไปอยู่ใต้เมนูนั้น
  master_agreements: 'Master Agreement',
  credit_agreements: 'Credit Agreement',
  facility_types: 'Credit Agreement',
  promissory_notes: 'Promissory Note',
  letter_guarantees: 'LG / BG',
  letters_of_credit: 'Letter of Credit',
  floor_plans: 'Floor Plan',
  fa_transfers: 'Floor Plan',
  facility_adjustments: 'Floor Plan',
  vehicles: 'Floor Plan',
  overdrafts: 'Overdraft',
  trust_receipts: 'Trust Receipt',
  fx_forwards: 'FX Forward Rate',
  loans: 'Loan',
  // ตารางเดียวใช้ร่วมกัน 3 เมนู — Hire Purchase · Leasing · Leasing Other
  // แยกไม่ได้เพราะประวัติไม่ได้เก็บว่าเป็นชนิดไหน ดูจากเลขที่สัญญาแทน
  leases: 'Lease',
  repayments: 'Repayment',
  ap_cheque_requests: 'Repayment',
  cen_t_schedule: 'Repayment',
  journal_entries: 'Journal Entries',
  netsuite_sync_log: 'Journal Entries',
  interest_rates: 'Interest Rate',
  curtailments: 'Curtailment',
  bank_statements: 'Bank Statement',
  bank_statement_lines: 'Bank Statement',
  gl_accounts: 'Chart of Accounts',
  permission_groups: 'Permission Groups',
  app_users: 'Users',
  // เข้า/ออกระบบ ไม่ได้สังกัดเมนูไหน — แยกไว้ให้กรองดูได้
  auth: 'Sign In / Sign Out',
};

export function moduleLabel(table: string): string {
  return MODULE_LABEL[table] ?? table;
}

/**
 * ตัวเลือกเมนูสำหรับตัวกรองหน้าประวัติการใช้งาน
 *
 * แสดงครบทุกเมนูเสมอ ไม่ใช่เฉพาะเมนูที่มีข้อมูล — ผู้ใช้จะได้รู้ว่า "ไม่มีใครแตะ" จริงๆ
 * ไม่ใช่ "ตัวกรองหาไม่เจอ"
 *
 * บางเมนูใช้หลายตารางร่วมกัน (เช่น Bank Statement เก็บทั้งหัวใบและบรรทัด)
 * จึงเก็บเป็นรายการตารางไว้ แล้วตอนกรองค่อยค้นทุกตารางในกลุ่มเดียวกัน
 */
export const MODULE_OPTIONS: { label: string; tables: string[] }[] = (() => {
  const byLabel = new Map<string, string[]>();
  for (const [table, label] of Object.entries(MODULE_LABEL)) {
    const list = byLabel.get(label) ?? [];
    list.push(table);
    byLabel.set(label, list);
  }
  return [...byLabel.entries()]
    .map(([label, tables]) => ({ label, tables }))
    .sort((a, b) => a.label.localeCompare(b.label));
})();

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
    summary: `${isNew ? 'สร้าง' : 'แก้ไข'} ${moduleLabel(table)}${label ? ` — ${label}` : ''}`,
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
    summary: `ลบ ${moduleLabel(table)}${label ? ` — ${label}` : ''}`,
    before,
  });
}
