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
  if (lineErr) {
    // แทรกบรรทัดบัญชีไม่สำเร็จ ต้องลบหัวใบทิ้งด้วย ไม่งั้นจะเหลือใบสำคัญเปล่า
    // ที่ยอด Dr/Cr มีเลขแต่ไม่มีบรรทัดรองรับ — งบจะไม่ตรงและตามหาต้นเหตุไม่เจอ
    await supabase.from('journal_entries').delete().eq('id', je.id);
    throw lineErr;
  }

  return je as JournalEntry;
}

/**
 * แปลงข้อผิดพลาดเรื่องข้อมูลซ้ำจากฐานข้อมูลเป็นภาษาคน
 * ดัชนีกันซ้ำที่ฐานข้อมูล (source_type + source_id + งวด เฉพาะใบที่ลงบัญชีแล้ว
 * และไม่ใช่ใบกลับรายการ) จะเด้งตอนเปลี่ยนสถานะเป็นลงบัญชีแล้ว
 */
function friendlyJEError(e: any): Error {
  const msg = String(e?.message ?? e ?? '');
  if (/duplicate key|unique constraint|uq_je_source_once/i.test(msg)) {
    return new Error('งานนี้ถูกลงบัญชีไปแล้ว — มีใบสำคัญของงวดนี้อยู่ในระบบแล้ว ไม่ต้องลงซ้ำ');
  }
  return e instanceof Error ? e : new Error(msg);
}

/** Post a Draft JE → Posted. Locks the entry. */
/**
 * ชื่อผู้ใช้ที่กำลังทำรายการอยู่ — อ่านจากที่เก็บสถานะการเข้าสู่ระบบ
 *
 * เดิมทุกหน้าส่งคำว่า 'user' ตายตัวเข้ามา (41 จุดทั่วระบบ) คอลัมน์ผู้ลงบัญชี
 * จึงขึ้นคำว่า user ทุกใบทุกคน ตรวจย้อนหลังไม่ได้ว่าใครเป็นคนลง
 * แก้ที่จุดเดียวตรงนี้ — ถ้าคนเรียกส่งค่าว่างหรือส่งคำว่า user มา ให้ไปหาชื่อจริงเอง
 */
export async function currentActorLabel(passed?: string | null): Promise<string> {
  return resolveActor(passed);
}

async function resolveActor(passed?: string | null): Promise<string> {
  const given = (passed ?? '').trim();
  if (given && given !== 'user' && given !== 'system') return given;
  try {
    const { useAuthStore } = await import('@/stores/useAuthStore');
    const s: any = useAuthStore.getState();
    const label = s.user?.name || s.user?.email || s.session?.user?.email;
    if (label) return label;
  } catch { /* ยังไม่พร้อม — ตกไปใช้ค่าที่ส่งมา */ }
  return given || 'system';
}

export async function postJE(jeId: string, actor?: string): Promise<void> {
  const postedBy = await resolveActor(actor);
  // ต้องขอแถวที่ถูกแก้กลับมาด้วย เพราะถ้าใบนี้ถูกลงบัญชีไปแล้วจากหน้าต่างอื่น
  // เงื่อนไข status='Draft' จะไม่ตรงแถวไหนเลย แต่ฐานข้อมูลไม่ถือว่าเป็นข้อผิดพลาด
  const { data: affected, error } = await supabase
    .from('journal_entries')
    .update({ status: 'Posted', posted_by: postedBy, posted_at: new Date().toISOString() })
    .eq('id', jeId)
    .eq('status', 'Draft')
    .select('id');
  if (error) throw friendlyJEError(error);
  if (!affected || affected.length === 0) {
    throw new Error('ใบสำคัญนี้ถูกลงบัญชีหรือเปลี่ยนสถานะไปแล้ว — กดรีเฟรชเพื่อดูสถานะล่าสุด');
  }

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
 * แปลงงวดบนใบสำคัญเป็นข้อความที่อ่านเข้าใจ
 * ใบตีราคาเงินตราเก็บงวดเป็นปีเดือนติดกัน 6 หลัก (เช่น 202608) ซึ่งอ่านไม่รู้เรื่อง
 * ส่วนโมดูลอื่นเก็บเป็นลำดับงวดตามตารางผ่อน (1, 2, 3, ...)
 */
export function formatJEPeriod(period: number | null | undefined): string {
  if (period == null) return '—';
  const year = Math.floor(period / 100);
  const month = period % 100;
  if (year >= 1900 && year <= 9999 && month >= 1 && month <= 12) {
    return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  return `งวดที่ ${period}`;
}

/**
 * ผลของการกลับรายการ — บอกด้วยว่าเดินไปทางไหน เพราะสองเส้นทางให้ผลต่างกัน
 *   reversal-je     = ออกใบกลับรายการใบใหม่ (je = ใบใหม่)
 *   same-day-cancel = ยกเลิกในวันเดียวกันโดยไม่ออกใบใหม่ (je = ใบเดิมที่เปลี่ยนสถานะแล้ว)
 */
export interface ReverseJEResult {
  je: JournalEntry;
  mode: 'reversal-je' | 'same-day-cancel';
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
export async function reverseJE(
  originalJeId: string,
  actor?: string,
): Promise<ReverseJEResult> {
  const postedBy = await resolveActor(actor);
  // Load original
  const { data: orig, error: e1 } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('id', originalJeId)
    .single();
  if (e1) throw e1;

  // ใบตีราคาเงินตราออกใบกลับรายการล่วงหน้าไว้ตั้งแต่ตอนลงบัญชี (ลงวันที่ต้นเดือนถัดไป)
  // และผูก reversed_by_je_id ไว้แล้ว แต่ใบต้นเรื่องยังสถานะ Posted อยู่
  // ถ้าไม่กันไว้ตรงนี้ กดกลับรายการอีกครั้งจะได้ใบกลับรายการซ้ำ กำไรขาดทุนถูกกลับออก 2 รอบ
  if (orig.reversed_by_je_id) {
    const { data: rev } = await supabase
      .from('journal_entries')
      .select('je_number, je_date')
      .eq('id', orig.reversed_by_je_id)
      .maybeSingle();
    throw new Error(
      rev?.je_number
        ? `ใบสำคัญนี้มีใบกลับรายการรออยู่แล้ว — เลขที่ ${rev.je_number}${rev.je_date ? ` ลงวันที่ ${rev.je_date}` : ''} ไม่ต้องกลับรายการซ้ำ`
        : 'ใบสำคัญนี้มีใบกลับรายการรออยู่แล้ว ไม่ต้องกลับรายการซ้ำ',
    );
  }

  if (orig.status !== 'Posted') throw new Error('กลับรายการได้เฉพาะใบสำคัญที่ลงบัญชีแล้วเท่านั้น');

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
    // คืนใบเดิม (ที่เพิ่งเปลี่ยนเป็น Reversed) พร้อมบอกว่ามาทางเส้นทางยกเลิกในวันเดียวกัน
    // เพื่อให้หน้าจอไม่ไปแสดงข้อความว่า "กลับรายการเป็นเลขที่ใบ ..." ซึ่งเป็นเลขใบเดิม
    const { data: updated } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', originalJeId)
      .single();
    return { je: updated as JournalEntry, mode: 'same-day-cancel' };
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

  return { je: reverse, mode: 'reversal-je' };
}

