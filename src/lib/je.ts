// Journal Entry helpers — create, post, reverse, void
import { supabase } from './supabase';
import type { JournalEntry, JELine } from '@/types/database';

import { toast } from 'sonner';
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
/**
 * ที่มาของใบสำคัญ — จัดกลุ่มตามเมนู พร้อมคำอธิบายภาษาคน
 *
 * รหัสที่เก็บในฐานข้อมูล (เช่น LG_ISSUE_OFFBALANCE) อ่านไม่รู้เรื่องสำหรับคนใช้งาน
 * และมี 32 ค่าเรียงยาวเป็นพืด หาไม่เจอว่าอันไหนของเมนูไหน
 * จึงจัดเป็นกลุ่มตามเมนู แล้วให้ชื่อเป็นคำอธิบายว่ารายการนั้นคืออะไร
 */
/**
 * ที่มาของใบสำคัญ — จัดตามชื่อเมนูในแถบเมนูซ้าย
 *
 * หน้าจอแสดงและกรองด้วย "ชื่อเมนู" เท่านั้น ไม่ลงรายละเอียดว่าเป็นรายการชนิดไหน
 * เพราะคอลัมน์คำอธิบายบอกอยู่แล้วว่าใบสำคัญนั้นเกิดจากอะไร
 * รหัสด้านล่างเป็นค่าที่เก็บจริงในฐานข้อมูล ใช้แปลงกลับไปมาเท่านั้น
 */
export const JE_SOURCE_MENUS: { menu: string; codes: string[] }[] = [
  { menu: 'Promissory Note',  codes: ['PN_DRAWDOWN', 'PN_ACCRUED'] },
  { menu: 'LG / BG',          codes: ['LG_ISSUE_OFFBALANCE', 'LG_FEE', 'LG_REFUND', 'LG_EXPIRE_REVERSE', 'LG_TERMINATE_REVERSE', 'LG_OFFBALANCE_REVERSE'] },
  { menu: 'Letter of Credit', codes: ['LC_FEE', 'LC_FEE_RECOG', 'LC_CONVERT', 'LC_SETTLE', 'LC_OFFBALANCE_REVERSE'] },
  { menu: 'Floor Plan',       codes: ['FP_DRAWDOWN', 'FP_ACCRUED', 'FP_CURTAIL', 'AR_AP_NETTING', 'FA_TRANSFER'] },
  { menu: 'Overdraft',        codes: ['OD_ACCRUED'] },
  { menu: 'Trust Receipt',    codes: ['TR_DRAWDOWN', 'TR_ACCRUED'] },
  { menu: 'FX Forward Rate',  codes: ['FXF_FEE', 'FX_VALUATION', 'FXF_SETTLEMENT', 'FXF_FAIRVALUE'] },
  { menu: 'Loan',             codes: ['LOAN_DRAWDOWN', 'LOAN_ACCRUED', 'LOAN_INT_PAY', 'LOAN_PREPAY'] },
  { menu: 'Lease',            codes: ['LEASE_DAY1', 'LEASE_PAY', 'LEASE_DEPR', 'LEASE_REBATE', 'LEASE_REMEASURE', 'LEASE_TRANSFER'] },
  { menu: 'Repayment',        codes: ['REPAYMENT'] },
  { menu: 'Reconcile',        codes: ['FACILITY_ADJUST'] },   // แท็บ Reconcile ใน P/N · Floor Plan · Trust Receipt · Loan
  { menu: 'Manual',           codes: ['MANUAL'] },   // คนคีย์เอง ไม่ได้เกิดจากสัญญาใด
];

/** ชื่อเมนู → รหัสทั้งหมดของเมนูนั้น (ใช้กรองรายการ) */
export function jeSourceCodes(menu: string): string[] {
  return JE_SOURCE_MENUS.find((g) => g.menu === menu)?.codes ?? [];
}

/** รหัสที่เก็บในฐานข้อมูล → ชื่อเมนูที่ใบสำคัญนั้นเกิดขึ้น */
const JE_SOURCE_MENU_OF: Record<string, string> = Object.fromEntries(
  JE_SOURCE_MENUS.flatMap((g) => g.codes.map((c) => [c, g.menu])),
);

/** รหัสที่มาของใบสำคัญ → ชื่อเมนูที่ใบสำคัญนั้นเกิดขึ้น */
export function jeSourceLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return JE_SOURCE_MENU_OF[code] ?? code;
}

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

/**
 * ตรวจว่ารหัสบัญชีบนใบสำคัญมีอยู่จริงในผังบัญชี
 *
 * รหัสบางชุดถูกกำหนดไว้ตายตัวในโปรแกรม (เช่น บัญชีดอกเบี้ยค้างจ่าย บัญชีตีราคาเงินตรา)
 * ไม่ได้อ่านจากทะเบียนผังบัญชี ถ้าผังบัญชีไม่มีรหัสนั้น ใบสำคัญจะถูกปฏิเสธตอนส่งเข้าระบบบัญชี
 * ปลายทาง โดยไม่มีอะไรเตือนตั้งแต่ต้นทาง — ตรงนี้จึงเตือนไว้ก่อน (ไม่บล็อกการลงบัญชี)
 */
async function warnUnknownAccounts(jeId: string): Promise<void> {
  try {
    const { data: lines } = await supabase
      .from('je_lines')
      .select('account_code')
      .eq('je_id', jeId);
    const codes = [...new Set((lines ?? []).map((l: any) => l.account_code).filter(Boolean))];
    if (codes.length === 0) return;

    const { data: known, error } = await supabase
      .from('gl_accounts')
      .select('code')
      .in('code', codes);
    if (error) return;                       // อ่านผังบัญชีไม่ได้ — ไม่ต้องรบกวนผู้ใช้
    // ผังบัญชียังว่างทั้งตาราง (เช่นระบบทดสอบ) — ไม่มีอะไรให้เทียบ
    const { count: total } = await supabase
      .from('gl_accounts')
      .select('id', { count: 'exact', head: true });
    if ((total ?? 0) === 0) return;

    const knownSet = new Set((known ?? []).map((r: any) => r.code));
    const missing = codes.filter((c) => !knownSet.has(c));
    if (missing.length > 0) {
      toast.warning(
        `รหัสบัญชี ${missing.join(', ')} ไม่มีในผังบัญชี — ` +
        `ใบสำคัญนี้อาจถูกปฏิเสธตอนส่งเข้าระบบบัญชีปลายทาง · ` +
        `ให้เพิ่มรหัสที่เมนูผังบัญชี หรือแก้บัญชีในสัญญาต้นทาง`,
        { duration: 10000 },
      );
    }
  } catch {
    /* การตรวจนี้เป็นตัวช่วยเฉยๆ — ล้มเหลวแล้วไม่ควรทำให้การลงบัญชีล้มตาม */
  }
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

  await warnUnknownAccounts(jeId);
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
 * ผลของการแก้ใบสำคัญ — บอกด้วยว่าเดินไปทางไหน เพราะสองเส้นทางให้ผลต่างกัน
 *   reversal-je = ออกใบกลับรายการใบใหม่ (je = ใบใหม่)
 *   cancel      = ยกเลิกใบเดิมโดยไม่ออกใบใหม่ (je = ใบเดิมที่เปลี่ยนสถานะแล้ว)
 */
export interface ReverseJEResult {
  je: JournalEntry;
  mode: 'reversal-je' | 'cancel';
}

/**
 * ใบสำคัญที่ยกเลิกได้เลย โดยไม่ต้องออกใบกลับรายการ
 *
 * เส้นแบ่งคือ "ตัวเลขออกไปนอกระบบหรือยัง" ไม่ใช่ "ลงบัญชีวันไหน"
 *   ยังไม่ส่ง NetSuite → NetSuite ไม่เคยเห็นใบนี้ ไม่มีอะไรให้ล้าง ยกเลิกใบเดิมได้เลย
 *   ส่งไปแล้ว        → ตัวเลขอยู่ใน NetSuite เรียกคืนไม่ได้ ต้องออกใบใหม่มาหักล้าง
 *
 * เดิมใช้เงื่อนไข "ลงบัญชีวันเดียวกัน" ซึ่งเป็นการเดาว่ายังไม่มีอะไรเกิดขึ้น
 * ทั้งที่ระบบรู้จาก sync_status อยู่แล้ว · ผลข้างเคียงของเงื่อนไขเดิมคือ
 * ใบที่ลงบัญชีเมื่อวานแต่ยังไม่ส่ง จะถูกบังคับให้ออกใบกลับรายการ
 * แล้วส่งใบคู่ที่หักล้างกันเองเข้า NetSuite ทั้งคู่โดยไม่จำเป็น
 *
 * หน้าจอใช้ฟังก์ชันนี้ตัดสินว่าจะขึ้นปุ่ม Cancel หรือ Reverse
 * จึงต้องใช้ตัวเดียวกับที่ reverseJE ใช้ ไม่งั้นปุ่มกับผลลัพธ์จะไม่ตรงกัน
 */
export function canCancelWithoutReversal(je: { sync_status?: string | null }): boolean {
  return je.sync_status !== 'synced';
}

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

  if (canCancelWithoutReversal(orig)) {
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
      summary: 'ยกเลิกใบสำคัญ — ยังไม่ได้ส่งเข้า NetSuite จึงไม่ต้องออกใบกลับรายการ',
    });
    // คืนใบเดิม (ที่เพิ่งเปลี่ยนเป็น Reversed) พร้อมบอกว่ามาทางเส้นทางยกเลิก
    // เพื่อให้หน้าจอไม่ไปแสดงข้อความว่า "กลับรายการเป็นเลขที่ใบ ..." ซึ่งเป็นเลขใบเดิม
    const { data: updated } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', originalJeId)
      .single();
    return { je: updated as JournalEntry, mode: 'cancel' };
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

