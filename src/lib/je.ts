// Journal Entry helpers — create, post, reverse, void
import { supabase } from './supabase';
import type { JournalEntry, JELine } from '@/types/database';

import { logAudit } from './audit-trail';

export interface NewJELine {
  account_code?: string;
  account_name: string;
  dr?: number;
  cr?: number;
  description?: string;
}

export interface NewJEInput {
  source_type: string;
  source_id?: string;
  source_period?: number;
  je_date: string;
  description?: string;
  remark?: string;
  lines: NewJELine[];
}

/**
 * Create a new Draft JE with auto-generated JE number.
 * Returns the inserted journal_entries row.
 */
export async function createJE(input: NewJEInput): Promise<JournalEntry> {
  // 1. Get next JE number from function
  const { data: numData, error: numErr } = await supabase.rpc('next_je_number');
  if (numErr) throw numErr;
  const jeNumber = numData as string;

  const total_dr = input.lines.reduce((s, l) => s + (l.dr ?? 0), 0);
  const total_cr = input.lines.reduce((s, l) => s + (l.cr ?? 0), 0);

  // Balanced check
  if (Math.abs(total_dr - total_cr) > 0.01) {
    throw new Error(`JE not balanced: Dr=${total_dr}, Cr=${total_cr}`);
  }

  // Posting period like "Oct 2024"
  const d = new Date(input.je_date);
  const postingPeriod = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

  // 2. Insert header
  const { data: je, error } = await supabase
    .from('journal_entries')
    .insert({
      je_number: jeNumber,
      source_type: input.source_type,
      source_id: input.source_id,
      source_period: input.source_period,
      je_date: input.je_date,
      posting_period: postingPeriod,
      description: input.description,
      total_dr,
      total_cr,
      status: 'Draft',
      remark: input.remark,
    })
    .select()
    .single();
  if (error) throw error;

  // 3. Insert lines
  const lineRows = input.lines.map((l, i) => ({
    je_id: je.id,
    line_no: i + 1,
    account_code: l.account_code,
    account_name: l.account_name,
    dr: l.dr ?? 0,
    cr: l.cr ?? 0,
    description: l.description,
  }));
  const { error: lineErr } = await supabase.from('je_lines').insert(lineRows);
  if (lineErr) throw lineErr;

  return je as JournalEntry;
}

/** Post a Draft JE → Posted. Locks the entry. */
export async function postJE(jeId: string, postedBy = 'system'): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .update({ status: 'Posted', posted_by: postedBy, posted_at: new Date().toISOString() })
    .eq('id', jeId)
    .eq('status', 'Draft');
  if (error) throw error;

  const { data: je } = await supabase.from('journal_entries').select('je_number').eq('id', jeId).single();
  await logAudit({
    action: 'post_je',
    table: 'journal_entries',
    recordId: jeId,
    recordLabel: je?.je_number ?? jeId,
    summary: `Posted JE`,
  });
}

/**
 * Reverse a Posted JE — creates a new JE that mirrors Dr/Cr.
 * Original JE: status stays Posted; new JE: status=Posted, is_reversal=true.
 * Both link via reversed_by_je_id.
 *
 * Gap 7 (MoM §6): Same-day reverse + ยังไม่ sync NetSuite → skip the reversal entirely
 * (mark original as Reversed, no new JE created). MoM ระบุชัด: "สร้างแล้วยกเลิกในวันเดียวกัน
 * ไม่ต้องส่ง · ถ้าข้ามวันให้ส่ง reverse" — เราต่อยอดเงื่อนไขนี้: ถ้ายังไม่เคย sync NetSuite
 * (sync_status != 'synced') และเป็นวันเดียวกัน → ไม่จำเป็นต้องสร้าง reversal JE
 * เพราะไม่มี downstream side effect ใน NetSuite ให้ต้องกลับรายการ
 */
export async function reverseJE(originalJeId: string, postedBy = 'system'): Promise<JournalEntry> {
  // Load original
  const { data: orig, error: e1 } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('id', originalJeId)
    .single();
  if (e1) throw e1;
  if (orig.status !== 'Posted') throw new Error('Reverse ทำได้เฉพาะ JE ที่ Posted แล้ว');

  // ── Gap 7: Same-day skip detection ─────────────────────────────────────
  // Compare original post date with today (local timezone). If same day AND
  // NetSuite sync hasn't happened yet → mark Reversed inline (no reversal JE).
  const today = new Date();
  const postedAt = orig.posted_at ? new Date(orig.posted_at) : null;
  const isSameDay =
    postedAt &&
    postedAt.getFullYear() === today.getFullYear() &&
    postedAt.getMonth() === today.getMonth() &&
    postedAt.getDate() === today.getDate();
  const isUnsynced = orig.sync_status !== 'synced';
  if (isSameDay && isUnsynced) {
    // No reversal JE — just mark original as Reversed
    await supabase
      .from('journal_entries')
      .update({
        status: 'Reversed',
        // No reversed_by_je_id — there's no reversal JE
      })
      .eq('id', originalJeId);
    await logAudit({
      action: 'reverse_je',
      table: 'journal_entries',
      recordId: originalJeId,
      recordLabel: orig.je_number,
      summary: `Reversed inline (same-day, unsynced) — no reversal JE created`,
    });
    // Return the original (now Reversed) — callers expecting a "reverse" object
    // can detect this path via `is_reversal === false` on the returned row.
    const { data: updated } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', originalJeId)
      .single();
    return updated as JournalEntry;
  }
  // ────────────────────────────────────────────────────────────────────────

  const { data: lines, error: e2 } = await supabase
    .from('je_lines')
    .select('*')
    .eq('je_id', originalJeId)
    .order('line_no');
  if (e2) throw e2;

  // Create reversal JE with swapped Dr/Cr
  const reverse = await createJE({
    source_type: orig.source_type,
    source_id: orig.source_id,
    source_period: orig.source_period,
    je_date: (() => {
      // Local-timezone-safe today.
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })(),
    description: `Reverse of ${orig.je_number}`,
    remark: `Reversal of JE ${orig.je_number}`,
    lines: (lines as JELine[]).map((l) => ({
      account_code: l.account_code ?? undefined,
      account_name: l.account_name ?? '',
      dr: l.cr,
      cr: l.dr,
      description: `Reverse: ${l.description ?? ''}`,
    })),
  });

  // Mark reversal flag + cross-link
  await supabase
    .from('journal_entries')
    .update({
      is_reversal: true,
      status: 'Posted',
      posted_by: postedBy,
      posted_at: new Date().toISOString(),
    })
    .eq('id', reverse.id);

  // Link original → reversal
  await supabase
    .from('journal_entries')
    .update({ status: 'Reversed', reversed_by_je_id: reverse.id })
    .eq('id', originalJeId);

  await logAudit({
    action: 'reverse_je',
    table: 'journal_entries',
    recordId: originalJeId,
    recordLabel: orig.je_number,
    summary: `Reversed → ${reverse.je_number}`,
  });

  return reverse;
}

