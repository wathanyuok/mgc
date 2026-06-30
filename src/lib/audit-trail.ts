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

export async function logAudit(opts: LogAuditOpts): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('audit_trail').insert({
      user_id: u?.user?.id ?? null,
      user_email: u?.user?.email ?? null,
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
