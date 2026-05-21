// System-generated running number — MoM Day3 §7/§99 (Confirmed).
// Each transaction type gets its own sequence; numbers never repeat (even after
// delete/close) because the DB counter only increments. Stored in the NAME field,
// separate from the bank's contract number (Bank Reference, user-keyed).
import { supabase } from './supabase';

// Prefix per facility type — keep stable; the running number is appended (5 digits).
export const RUNNING_PREFIX: Record<string, string> = {
  pn: 'PN', lg: 'LG', bg: 'BG', lc: 'LC', fp: 'FP', od: 'OD',
  tr: 'TR', fxf: 'FXF', loan: 'LN', lease: 'LSE', hp: 'HP',
};

/**
 * Returns the next running number for a prefix (e.g. "PN00001").
 * Falls back to a timestamp-based value if the DB function isn't available yet
 * (migration not applied), so the UI never blocks.
 */
export async function nextRunningNo(prefix: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('next_running_no', { p_prefix: prefix });
    if (error) throw error;
    if (data) return data as string;
  } catch {
    /* fall through to fallback */
  }
  // Fallback (pre-migration): prefix + last 5 digits of epoch seconds.
  return prefix + String(Math.floor(Date.now() / 1000)).slice(-5);
}
