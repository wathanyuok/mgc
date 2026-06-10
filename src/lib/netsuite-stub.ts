// NetSuite Sync Stub — Phase 3 placeholder
// In production, this will call NetSuite SuiteTalk REST API to create a Journal Entry.
// For now, it logs the payload to console and returns a mock NetSuite JE ID.
// Once MGC IT provides credentials + Chart of Accounts mapping, swap the body of
// `pushJournalEntryToNetSuite` with the real API call.

import { supabase } from './supabase';
import { logAudit } from './audit-trail';

export interface NetSuiteSyncResult {
  netsuite_je_id: string;
  synced_at: string;
  sync_status: 'synced';
}

/**
 * Push a Supabase Journal Entry to NetSuite GL.
 * - Loads the JE + lines from Supabase
 * - Constructs NetSuite payload (mocked here)
 * - "Sends" via console.log (stub)
 * - Updates Supabase with sync metadata
 */
export async function pushJournalEntryToNetSuite(jeId: string): Promise<NetSuiteSyncResult> {
  const startMs = Date.now();
  const [hdr, lines] = await Promise.all([
    supabase.from('journal_entries').select('*').eq('id', jeId).single(),
    supabase.from('je_lines').select('*').eq('je_id', jeId).order('line_no'),
  ]);
  if (hdr.error) throw hdr.error;
  if (lines.error) throw lines.error;

  // Build NetSuite payload (SuiteTalk REST shape)
  const payload = {
    tranid: hdr.data.je_number,
    trandate: hdr.data.je_date,
    memo: hdr.data.description,
    subsidiary: { id: '1' }, // TODO: derive from CA or org
    line: (lines.data ?? []).map((l: any) => ({
      account: { id: l.account_code },
      memo: l.description,
      debit: l.dr || 0,
      credit: l.cr || 0,
    })),
    externalid: `YIP-${hdr.data.je_number}`,
  };

  // STUB: log payload + return mock ID
  // ───────────────────────────────────────────────
  console.log('🔵 [NetSuite Stub] Pushing JE:', payload);
  let syncStatus: 'success' | 'failed' = 'success';
  let responseStatus = 200;
  let errorMessage: string | null = null;
  let mockNsId = '';
  try {
    await new Promise((r) => setTimeout(r, 400)); // simulate network latency
    mockNsId = `NS-JE-${Date.now()}`;
    console.log(`✅ [NetSuite Stub] Created with ID: ${mockNsId}`);
  } catch (e: any) {
    syncStatus = 'failed';
    responseStatus = 500;
    errorMessage = e?.message ?? String(e);
  }
  // ───────────────────────────────────────────────
  // REAL implementation (when credentials available):
  // const res = await fetch(`${NETSUITE_BASE}/journalentry`, {
  // method: 'POST',
  // headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  // body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new Error(`NetSuite ${res.status}: ${await res.text()}`);
  // const nsResponse = await res.json();
  // const nsId = nsResponse.id;

  const synced_at = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  // Best-effort: write to sync_log table (graceful if table not yet migrated)
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('netsuite_sync_log').insert({
      je_id: jeId,
      je_number: hdr.data.je_number,
      sync_method: 'stub',
      triggered_by: u?.user?.email ?? u?.user?.id ?? 'unknown',
      request_payload: payload,
      response_status: responseStatus,
      response_body: { netsuite_je_id: mockNsId },
      netsuite_je_id: mockNsId,
      sync_status: syncStatus,
      error_message: errorMessage,
      duration_ms: durationMs,
    });
  } catch (logErr) {
    console.warn('[sync_log] insert skipped:', logErr);
  }

  if (syncStatus === 'failed') {
    // Mark the JE as failed so JE List shows "❌ Sync Failed" badge
    await supabase
      .from('journal_entries')
      .update({ sync_status: 'failed' })
      .eq('id', jeId);
    throw new Error(errorMessage ?? 'NetSuite sync failed');
  }

  const { error: updErr } = await supabase
    .from('journal_entries')
    .update({
      netsuite_je_id: mockNsId,
      netsuite_synced_at: synced_at,
      sync_status: 'synced',
    })
    .eq('id', jeId);
  if (updErr) throw updErr;

  // Audit trail entry — user action
  await logAudit({
    action: 'sync_netsuite',
    table: 'journal_entries',
    recordId: jeId,
    recordLabel: hdr.data.je_number,
    summary: `Synced to NetSuite as ${mockNsId} (${durationMs}ms)`,
  });

  return { netsuite_je_id: mockNsId, synced_at, sync_status: 'synced' };
}
