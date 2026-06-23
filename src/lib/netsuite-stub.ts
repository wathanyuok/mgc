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

export interface NetSuiteAPSyncResult {
  netsuite_ap_id: string;
  synced_at: string;
  sync_status: 'synced';
}

/**
 * Resolve "entity" + chassis info from a JE's source facility.
 * NetSuite tracks by vendor/customer entity (no contract concept), so we
 * dereference source_type → facility table → derive:
 *   - subsidiary_id  = MGC company (NetSuite subsidiary)
 *   - vendor_id      = counterparty (bank for borrowings; supplier for AP; lessor for IFRS 16)
 *   - chassis_no     = vehicle serial (when applicable — Loan/Lease/HP/FP/PN)
 *
 * Per MoM §6 (GL Setup): "ตั้งตาม vendor (NetSuite ไม่มี concept สัญญา) ·
 * track ได้ในระดับ vendor / บริษัทที่ใช้วงเงิน ไม่ลงถึงระดับสัญญา"
 */
async function resolveEntityFromSource(
  source_type: string | null,
  source_id: string | null,
): Promise<{
  subsidiary_id: string | null;
  vendor_id: string | null;
  chassis_no: string | null;
  facility_no: string | null;
}> {
  const empty = { subsidiary_id: null, vendor_id: null, chassis_no: null, facility_no: null };
  if (!source_type || !source_id) return empty;

  // Map source_type → [table, natural-key column, facility→MA path]
  // For most facilities, the chain is: facility → CA → MA → {subsidiary_id, finance_institution_id}
  // Exceptions:
  //   - Leases (HP/Lease/IFRS16) are MA-direct (no CA), via leases.ma_id
  //   - REPAYMENT/LEASE_PAYMENT are pseudo-types: look up underlying via repayments.facility_*
  const t = source_type.toUpperCase();
  try {
    // 1) Repayment-typed JE — dereference one level down to the funded facility
    if (t === 'REPAYMENT' || t === 'LEASE_PAYMENT') {
      const { data: rp } = await supabase
        .from('repayments')
        .select('facility_type, facility_id')
        .eq('id', source_id)
        .maybeSingle();
      if (rp?.facility_type && rp.facility_id) {
        return resolveEntityFromSource(rp.facility_type, rp.facility_id);
      }
      return empty;
    }

    // 2) Lease/HP — MA-direct + has chassis_no
    if (t === 'LEASE' || t === 'HP') {
      const { data: l } = await supabase
        .from('leases')
        .select('lease_no, chassis_no, ma_id, master_agreements!inner(subsidiary_id, finance_institution_id)')
        .eq('id', source_id)
        .maybeSingle();
      if (l) {
        const ma: any = l.master_agreements;
        return {
          subsidiary_id: ma?.subsidiary_id ?? null,
          vendor_id: ma?.finance_institution_id ?? null,
          chassis_no: (l as any).chassis_no ?? null,
          facility_no: (l as any).lease_no ?? null,
        };
      }
      return empty;
    }

    // 3) Loan / PN / FP / OD / TR / FXF / LG / LC — facility → CA → MA
    const tableMap: Record<string, { table: string; noCol: string; chassisCol?: string }> = {
      LOAN: { table: 'loans', noCol: 'loan_no', chassisCol: 'chassis_no' },
      PN: { table: 'promissory_notes', noCol: 'name' },
      FP: { table: 'floor_plans', noCol: 'fp_no' },
      OD: { table: 'overdrafts', noCol: 'od_no' },
      TR: { table: 'trust_receipts', noCol: 'tr_no' },
      FXF: { table: 'fx_forwards', noCol: 'fxf_no' },
      LG: { table: 'letter_guarantees', noCol: 'lg_no' },
      LC: { table: 'letter_of_credit', noCol: 'lc_no' },
      BG: { table: 'letter_guarantees', noCol: 'lg_no' },
    };
    const m = tableMap[t];
    if (!m) return empty;
    const cols = `id, ${m.noCol}${m.chassisCol ? `, ${m.chassisCol}` : ''}, ca_id, credit_agreements!inner(ma_id, master_agreements!inner(subsidiary_id, finance_institution_id))`;
    const { data: row } = await supabase
      .from(m.table)
      .select(cols as any)
      .eq('id', source_id)
      .maybeSingle();
    if (!row) return empty;
    const ma: any = (row as any).credit_agreements?.master_agreements;
    return {
      subsidiary_id: ma?.subsidiary_id ?? null,
      vendor_id: ma?.finance_institution_id ?? null,
      chassis_no: m.chassisCol ? ((row as any)[m.chassisCol] ?? null) : null,
      facility_no: (row as any)[m.noCol] ?? null,
    };
  } catch (e) {
    console.warn('[resolveEntity] dereference failed:', e);
    return empty;
  }
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

  // Gap 5 + 6 (MoM §6) — Resolve entity + chassis from source facility
  // NetSuite tracks by vendor/subsidiary (ไม่มี concept สัญญา) — must pass these explicitly.
  const entity = await resolveEntityFromSource(hdr.data.source_type, hdr.data.source_id);

  // Build NetSuite payload (SuiteTalk REST shape — aligned with GL Opening Account template V01R00_01)
  // Template column order: External ID · Date · Reverse Date · Currency · Exchange Rate · Memo (Main) ·
  //                       Subsidiary · Account · Debit · Credit · Name (Entity) · Location · Profit/Cost ·
  //                       RPT Accounting · RPT Finance · Chasis · Business Type · Brand · Account Group ·
  //                       Project · Internal Adjustment · Memo Line
  const payload = {
    externalid: `YIP-${hdr.data.je_number}`,
    tranid: hdr.data.je_number,
    trandate: hdr.data.je_date,
    // Reverse Date — intentionally OMITTED. NetSuite's Reverse Date triggers auto-reverse on a future date,
    // but our system creates reversal JEs explicitly (see reverseJE() in lib/je.ts). Sending Reverse Date
    // would cause double-reversal. MoM §6.3 ("cross-day → ส่ง reverse") = send a separate reversal JE.
    // Round 1 enhancement — Currency + Exchange Rate (default THB / 1)
    currency: { refName: 'THB' },
    exchangerate: 1.0,
    memo: hdr.data.description,
    // Subsidiary — MGC company — derived from MA → subsidiary_id · falls back to '1' (default sub)
    subsidiary: { id: entity.subsidiary_id ?? '1' },
    // Entity — counterparty (bank/lessor/supplier/customer) — derived from MA → finance_institution_id
    entity: entity.vendor_id ? { id: entity.vendor_id } : null,
    // Custom body fields — match GL template column names (NetSuite uses 'Chasis' — typo preserved
    // for direct mapping with template import logic per NetSuite admin)
    custbody_facility_no: entity.facility_no,
    custbody_chasis: entity.chassis_no,
    // Optional fields (Location / Profit Center / RPT Accounting / RPT Finance / Business Type / Brand /
    // Account Group / Project / Internal Adjustment) — left to NetSuite-side defaults · MGC ไม่ track field เหล่านี้
    line: (lines.data ?? []).map((l: any) => ({
      account: { id: l.account_code },
      memo: l.description,
      debit: l.dr || 0,
      credit: l.cr || 0,
    })),
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

/**
 * Push an AP Cheque Request to NetSuite AP Bill module (Gap 1 · MoM §4).
 * Payload follows NetSuite AP Bill template V01R00_01 (28 fields):
 *   Header: External ID · Reference No · Vendor · Account · Currency · Exchange Rate · Date · Due Date ·
 *           Terms · Memo · Subsidiary · Location · Profit/Cost Center
 *   Line:   Account (Expense) · Amount · Tax Code · Tax amount · Gross Amt · Memo Line · Location ·
 *           Profit/Cost Center · RPT Accounting · RPT Finance · Chasis · Business Type · Brand ·
 *           Account Group · Project
 *
 * Trigger: หลัง user save Repayment ที่ channel = 'Cheque' หรือ 'AP Module' →
 *          ระบบ create ap_cheque_requests row → call this function → NetSuite ออกเช็คให้
 *
 * STUB MODE: logs payload + returns mock NetSuite AP Bill ID. Once MGC IT provides:
 *   - NetSuite credentials (token)
 *   - AP account ID
 *   - Tax code mapping
 *   - Webhook URL for cheque_no callback
 * → swap stub body with real SuiteTalk POST /vendorbill call.
 */
export async function pushCheckRequestToNetSuite(chequeRequestId: string): Promise<NetSuiteAPSyncResult> {
  const startMs = Date.now();

  // 1. Load AP cheque request + linked repayment (for date / facility ref)
  const { data: cheque, error: cqErr } = await supabase
    .from('ap_cheque_requests')
    .select('*, repayments(repayment_no, pay_date, facility_type, facility_id)')
    .eq('id', chequeRequestId)
    .single();
  if (cqErr) throw cqErr;
  if (!cheque) throw new Error('AP cheque request not found');

  // 2. Resolve entity (vendor) + subsidiary + chassis from source facility
  const entity = await resolveEntityFromSource(
    (cheque.repayments as any)?.facility_type ?? cheque.source_type,
    (cheque.repayments as any)?.facility_id ?? cheque.source_id,
  );

  // 3. If vendor not mapped to NetSuite yet → block sync with clear error
  if (!entity.vendor_id) {
    throw new Error(
      `AP Cheque sync ล้มเหลว — Vendor ของสัญญานี้ยังไม่ map กับ NetSuite (vendor_id = NULL). `
      + `กรุณากรอก netsuite_vendor_id ใน Vendor Master ก่อน`
    );
  }

  const repNo = (cheque.repayments as any)?.repayment_no ?? cheque.id.slice(0, 8);
  const payDate = (cheque.repayments as any)?.pay_date ?? new Date().toISOString().slice(0, 10);
  const dueDate = cheque.due_date ?? payDate;

  // 4. Build NetSuite AP Bill payload (per AP Bill template V01R00_01)
  const payload = {
    externalid: `YIP-CHQ-${repNo}-${chequeRequestId.slice(0, 8)}`,
    refnumber: cheque.cheque_no || repNo,
    entity: { id: entity.vendor_id },           // Vendor
    account: { id: cheque.gl_account || '2110000' }, // AP account (default 2110000 = Accounts Payable)
    currency: { refName: cheque.currency || 'THB' },
    exchangerate: 1.0,
    trandate: payDate,
    duedate: dueDate,
    terms: { refName: 'Net 0' },                // Default — รอ MGC ระบุ payment terms
    memo: cheque.memo ?? `Repayment ${repNo}`,
    subsidiary: { id: entity.subsidiary_id ?? '1' },
    // Custom body fields (match AP Bill template column names)
    custbody_facility_no: entity.facility_no,
    custbody_chasis: entity.chassis_no,
    // Single expense line (cheque คือ AP bill ที่ลูกค้าออกให้ vendor)
    expense: [
      {
        account: { id: cheque.gl_account || '2110000' },
        amount: cheque.amount,
        memo: cheque.memo ?? `Cheque payment — ${repNo}`,
        // Optional fields ปล่อย NetSuite-side defaults: Location, Cost Center,
        // RPT Accounting, RPT Finance, Business Type, Brand, Account Group, Project
      },
    ],
  };

  // STUB: log payload + return mock ID
  console.log('🟡 [NetSuite Stub · AP Bill] Pushing Cheque:', payload);
  let syncStatus: 'success' | 'failed' = 'success';
  let responseStatus = 200;
  let errorMessage: string | null = null;
  let mockApId = '';
  try {
    await new Promise((r) => setTimeout(r, 400));
    mockApId = `NS-AP-${Date.now()}`;
    console.log(`✅ [NetSuite Stub · AP Bill] Created with ID: ${mockApId}`);
  } catch (e: any) {
    syncStatus = 'failed';
    responseStatus = 500;
    errorMessage = e?.message ?? String(e);
  }
  // REAL implementation (when credentials available):
  // const res = await fetch(`${NETSUITE_BASE}/vendorbill`, {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) throw new Error(`NetSuite AP ${res.status}: ${await res.text()}`);
  // const nsResponse = await res.json();
  // const nsId = nsResponse.id;

  const synced_at = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  // Update ap_cheque_requests with sync metadata
  if (syncStatus === 'failed') {
    await supabase
      .from('ap_cheque_requests')
      .update({
        sync_status: 'failed',
        sync_error: errorMessage,
        netsuite_payload: payload,
      })
      .eq('id', chequeRequestId);
    throw new Error(errorMessage ?? 'NetSuite AP sync failed');
  }
  await supabase
    .from('ap_cheque_requests')
    .update({
      netsuite_ap_id: mockApId,
      netsuite_payload: payload,
      netsuite_response: { id: mockApId, status: responseStatus },
      sync_status: 'synced',
      sync_error: null,
    })
    .eq('id', chequeRequestId);

  // Best-effort sync log
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('netsuite_sync_log').insert({
      je_id: cheque.je_id,                    // link to source JE if any
      je_number: `CHQ-${repNo}`,
      sync_method: 'stub',
      triggered_by: u?.user?.email ?? u?.user?.id ?? 'unknown',
      request_payload: payload,
      response_status: responseStatus,
      response_body: { netsuite_ap_id: mockApId },
      netsuite_je_id: mockApId,               // reuse column for AP id (sync_log doesn't have AP-specific col)
      sync_status: syncStatus,
      error_message: errorMessage,
      duration_ms: durationMs,
    });
  } catch (logErr) {
    console.warn('[sync_log] AP insert skipped:', logErr);
  }

  await logAudit({
    action: 'sync_netsuite',
    table: 'ap_cheque_requests',
    recordId: chequeRequestId,
    recordLabel: `CHQ-${repNo}`,
    summary: `Synced to NetSuite AP as ${mockApId} (${durationMs}ms)`,
  });

  return { netsuite_ap_id: mockApId, synced_at, sync_status: 'synced' };
}
