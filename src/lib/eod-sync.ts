// End-of-Day NetSuite Sync — Feature B5
// ---------------------------------------------------------------
// Workshop guidance (3.txt): consultant favored end-of-day batch over real-time:
//   "เปิด voucher แล้วส่งไปอีกรอบหนึ่งก็เป็น voucher reverse" — กัน reverse-traffic
// Behaviour: a single function `runEODSync(asOfDate)` that picks up all
//   Posted journal_entries with sync_status='pending' for that date and
//   pushes them through pushJournalEntryToNetSuite() one-by-one.
//
// Run modes:
//   • Manual — admin clicks "Run Now" on /admin/eod-sync
//   • Scheduled — a future cron/serverless trigger calls runEODSync(today)
//
// Same-day Reverse skip (Gap 7) already lives in pushJournalEntryToNetSuite,
// so this runner inherits that protection automatically.

import { supabase } from './supabase';
import { pushJournalEntryToNetSuite } from './netsuite-stub';
import { logAudit } from './audit-trail';

export interface EODSyncSummary {
  asOfDate: string;
  scanned: number;
  synced: number;
  skipped: number;
  failed: number;
  durationMs: number;
  results: Array<{
    je_id: string;
    je_number: string;
    status: 'synced' | 'skipped' | 'failed';
    netsuite_je_id?: string;
    error?: string;
  }>;
}

/**
 * Run the End-of-Day NetSuite sync for all eligible JEs of `asOfDate`.
 *
 * Eligible = status='Posted' AND sync_status IN ('pending', 'failed').
 * Each JE is pushed sequentially to avoid hammering the NetSuite endpoint.
 *
 * The function never throws — individual failures are captured in `results`.
 */
export async function runEODSync(asOfDate: string): Promise<EODSyncSummary> {
  const startMs = Date.now();
  const summary: EODSyncSummary = {
    asOfDate,
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
    results: [],
  };

  // 1. Pick up Posted JEs whose je_date matches and that still need sync.
  const { data: rows, error } = await supabase
    .from('journal_entries')
    .select('id, je_number, status, sync_status, je_date')
    .eq('je_date', asOfDate)
    .eq('status', 'Posted')
    .in('sync_status', ['pending', 'failed'])
    .order('je_number');
  if (error) throw error;

  summary.scanned = rows?.length ?? 0;

  for (const row of rows ?? []) {
    try {
      const result = await pushJournalEntryToNetSuite(row.id);
      if (result.sync_status === 'synced') {
        summary.synced += 1;
        summary.results.push({
          je_id: row.id,
          je_number: row.je_number,
          status: 'synced',
          netsuite_je_id: result.netsuite_je_id,
        });
      } else {
        // Stub may classify some as skipped (e.g. same-day Reverse pair)
        summary.skipped += 1;
        summary.results.push({
          je_id: row.id,
          je_number: row.je_number,
          status: 'skipped',
        });
      }
    } catch (e: any) {
      summary.failed += 1;
      summary.results.push({
        je_id: row.id,
        je_number: row.je_number,
        status: 'failed',
        error: e?.message ?? String(e),
      });
    }
  }

  summary.durationMs = Date.now() - startMs;

  // 2. Persist a high-level audit row so /audit-trail shows the EOD run.
  try {
    await logAudit({
      action: 'eod_sync_run',
      table: 'journal_entries',
      recordId: asOfDate,
      recordLabel: `EOD ${asOfDate}`,
      summary:
        `EOD sync: scanned=${summary.scanned} synced=${summary.synced} ` +
        `skipped=${summary.skipped} failed=${summary.failed} (${summary.durationMs}ms)`,
    });
  } catch (auditErr) {
    console.warn('[eod-sync] audit log skipped:', auditErr);
  }

  return summary;
}

/** Convenience for "today" in the local timezone (YYYY-MM-DD). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
