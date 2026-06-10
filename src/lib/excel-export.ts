// Excel Export Utilities — used by JE List, Sync Log, Audit Trail pages.
// Auditor-friendly outputs (auto-fit columns, multi-sheet).
import * as XLSX from 'xlsx';

const today = () => new Date().toISOString().split('T')[0];

function autoFitColumns(ws: XLSX.WorkSheet, rows: Record<string, any>[]) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  ws['!cols'] = keys.map((k) => {
    const maxLen = Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
  });
}

export function exportJEListToExcel(
  jes: Array<{
    id?: string;
    je_number: string;
    je_date: string;
    posting_period?: string | null;
    source_type: string;
    description: string | null;
    total_dr: number;
    total_cr: number;
    status: string;
    netsuite_je_id?: string | null;
    sync_status?: string | null;
    netsuite_synced_at?: string | null;
    posted_at?: string | null;
    posted_by?: string | null;
    is_reversal?: boolean | null;
  }>,
  filename = `JE_Listing_${today()}.xlsx`,
  lines?: Array<{
    je_id: string;
    line_no: number;
    account_code?: string | null;
    account_name?: string | null;
    description?: string | null;
    dr: number;
    cr: number;
  }>,
) {
  // Sheet 1 — JE Header overview
  const headerRows = jes.map((j) => ({
    'JE Number': j.je_number,
    'JE Date': j.je_date,
    'Posting Period': j.posting_period ?? '',
    'Source Type': j.source_type,
    'Description': j.description ?? '',
    'Debit': j.total_dr,
    'Credit': j.total_cr,
    'Status': j.status,
    'Is Reversal': j.is_reversal ? 'Yes' : '',
    'NetSuite ID': j.netsuite_je_id ?? '',
    'Sync Status': j.sync_status ?? '',
    'Synced At': j.netsuite_synced_at ?? '',
    'Posted At': j.posted_at ?? '',
    'Posted By': j.posted_by ?? '',
  }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(headerRows);
  autoFitColumns(ws1, headerRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'JE Header');

  // Sheet 2 — JE Lines (for Auditor — Account Code + Memo per line, ดูภาษี VAT/WHT ได้)
  if (lines && lines.length > 0) {
    const jeMap = new Map(jes.filter((j) => j.id).map((j) => [j.id!, j]));
    const lineRows = lines.map((l) => {
      const je = jeMap.get(l.je_id);
      return {
        'JE Number': je?.je_number ?? '',
        'JE Date': je?.je_date ?? '',
        'Posting Period': je?.posting_period ?? '',
        'Source Type': je?.source_type ?? '',
        'Line No': l.line_no,
        'Account Code': l.account_code ?? '',
        'Account Name': l.account_name ?? '',
        'Line Memo': l.description ?? '',
        'Debit': l.dr,
        'Credit': l.cr,
        'JE Status': je?.status ?? '',
      };
    });
    const ws2 = XLSX.utils.json_to_sheet(lineRows);
    autoFitColumns(ws2, lineRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'JE Lines (Audit)');
  }

  XLSX.writeFile(wb, filename);
}

export function exportSyncLogToExcel(
  logs: Array<{
    created_at: string;
    je_id: string | null;
    je_number: string;
    sync_method: string;
    triggered_by: string | null;
    response_status: number | null;
    sync_status: string;
    netsuite_je_id: string | null;
    error_message: string | null;
    duration_ms?: number | null;
  }>,
  filename = `NetSuite_Sync_Log_${today()}.xlsx`,
) {
  const rows = logs.map((l) => ({
    'Timestamp': l.created_at,
    'JE Number': l.je_number,
    'Method': l.sync_method,
    'Triggered By': l.triggered_by ?? '',
    'HTTP Status': l.response_status ?? '',
    'Sync Status': l.sync_status,
    'NetSuite JE ID': l.netsuite_je_id ?? '',
    'Duration (ms)': l.duration_ms ?? '',
    'Error': l.error_message ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  autoFitColumns(ws, rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'NetSuite Sync Log');
  XLSX.writeFile(wb, filename);
}

export function exportAuditTrailToExcel(
  records: Array<{
    created_at: string;
    user_id: string | null;
    user_email?: string | null;
    action: string;
    table_name: string;
    record_id: string | null;
    record_label?: string | null;
    summary?: string | null;
  }>,
  filename = `Audit_Trail_${today()}.xlsx`,
) {
  const rows = records.map((r) => ({
    'Timestamp': r.created_at,
    'User': r.user_email ?? r.user_id ?? '',
    'Action': r.action,
    'Module': r.table_name,
    'Record ID': r.record_id ?? '',
    'Record Label': r.record_label ?? '',
    'Summary': r.summary ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  autoFitColumns(ws, rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit Trail');
  XLSX.writeFile(wb, filename);
}
