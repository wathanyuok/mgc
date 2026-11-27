import { supabase } from '@/lib/supabase';

/**
 * Fetch a Credit Agreement's default Rate Cards + Accounting Cards.
 * Used so that a transaction created under a CA inherits the CA's
 * Interest Rate (rate_cards) and Accounting (acct_cards) as editable defaults
 *.
 */
export async function fetchCaCards(
  caId: string,
): Promise<{ rate_cards: any[]; acct_cards: any[]; fi: string; currency: string }> {
  const { data } = await supabase
    .from('credit_agreements')
    .select('rate_cards, acct_cards, finance_institution, currency')
    .eq('id', caId)
    .maybeSingle();
  return {
    rate_cards: ((data as any)?.rate_cards as any[]) ?? [],
    acct_cards: ((data as any)?.acct_cards as any[]) ?? [],
    // สถาบันการเงินของวงเงิน — รายการธุรกรรมต้องใช้ธนาคารเดียวกับวงเงินเสมอ
    fi: ((data as any)?.finance_institution as string) ?? '',
    // สกุลเงินของวงเงิน — ใช้ default ให้รายการธุรกรรม (แก้ได้ · เตือนถ้าไม่ตรง)
    currency: ((data as any)?.currency as string) ?? '',
  };
}

export type CaCards = { rate_cards: any[]; acct_cards: any[]; fi: string; currency: string };

/**
 * รวมค่าที่ธุรกรรมควร "สืบทอด" จากวงเงิน (CA) เมื่อผู้ใช้เลือกวงเงิน — helper กลางใช้ทุกโมดูล
 * (แทนโค้ด merge ที่เดิมก็อปวางซ้ำในทุกหน้า)
 *
 * กติกา:
 *   • finance_institution — ตามวงเงินเสมอ (ธุรกรรมต้องใช้ธนาคารเดียวกับวงเงิน)
 *   • currency            — ตั้ง default ตามวงเงิน (CA ชนะถ้ามี) · เฉพาะฟอร์มที่มีช่อง currency
 *   • rate_cards / acct_cards — ดึงให้เฉพาะตอนที่ยัง "ว่าง" เท่านั้น (ไม่ทับค่าที่ผู้ใช้แก้เอง)
 *
 * ใช้:  setForm((f) => ({ ...f, ...caInheritPatch(f, cc) }))
 */
export function caInheritPatch<T extends Record<string, any>>(form: T, cc: CaCards): Partial<T> {
  const patch: Record<string, any> = {
    finance_institution: cc.fi || (form as any).finance_institution,
    rate_cards: ((form as any).rate_cards && (form as any).rate_cards.length) ? (form as any).rate_cards : cc.rate_cards,
    acct_cards: ((form as any).acct_cards && (form as any).acct_cards.length) ? (form as any).acct_cards : cc.acct_cards,
  };
  // ตั้ง default สกุลเงินตามวงเงิน — เฉพาะฟอร์มที่มีช่อง currency (TR/PN/LC/… ที่รองรับสกุลต่างประเทศ)
  if ('currency' in form) patch.currency = cc.currency || (form as any).currency;
  return patch as Partial<T>;
}

/** สกุลเงินธุรกรรมไม่ตรงกับวงเงินไหม — ใช้โชว์คำเตือน (soft) */
export function caCurrencyMismatch(txCurrency: string | null | undefined, caCurrency: string | null | undefined): boolean {
  if (!txCurrency || !caCurrency) return false;
  return txCurrency.trim().toUpperCase() !== caCurrency.trim().toUpperCase();
}

/** วงเงิน (CA) + ช่วงวันที่ของตัวมันเองและของสัญญาแม่ (MA) สำหรับเช็ก "ครอบคลุม" วันทำรายการ */
export interface CaDateItem {
  id: string;
  start_date?: string | null;
  end_date?: string | null;
  ma_start_date?: string | null;
  ma_end_date?: string | null;
}

// วันที่ (ISO yyyy-mm-dd) อยู่ในช่วง [start, end] ไหม · เทียบสตริงได้เพราะ ISO เรียงตามเวลา · end ว่าง = เปิดปลาย
function dateWithin(d: string, start?: string | null, end?: string | null): boolean {
  if (!d) return true;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/** วันทำรายการอยู่ในช่วงที่ทั้ง CA และ MA ครอบคลุมไหม (ไม่มีวันที่ = ถือว่าผ่าน ไม่กรองทิ้ง) */
export function caCoversDate(ca: CaDateItem, txDate: string | null | undefined): boolean {
  if (!txDate) return true;
  return dateWithin(txDate, ca.start_date, ca.end_date) && dateWithin(txDate, ca.ma_start_date, ca.ma_end_date);
}

/**
 * กรองรายการ CA ให้เหลือเฉพาะใบที่ "ครอบคลุม" วันทำรายการ
 *   • ยังไม่กรอกวันทำรายการ → คืนทั้งหมด
 *   • คง CA ที่เลือกไว้เสมอ (กันหายตอนเปิดรายการเก่าที่ CA หมดอายุไปแล้ว)
 */
export function filterCaByDate<T extends CaDateItem>(
  list: T[],
  txDate: string | null | undefined,
  currentCaId: string | null | undefined,
): T[] {
  if (!txDate) return list;
  return list.filter((c) => c.id === currentCaId || caCoversDate(c, txDate));
}

/** ข้อความเตือนตอน Save/ส่งอนุมัติ ถ้าวันทำรายการอยู่นอกช่วง CA หรือ MA · null = ผ่าน */
export function caDateCoverageWarning(
  ca: CaDateItem | null | undefined,
  txDate: string | null | undefined,
): string | null {
  if (!ca || !txDate) return null;
  const f = (s?: string | null) => (s ? s.split('-').reverse().join('/') : '—');
  if (!dateWithin(txDate, ca.start_date, ca.end_date))
    return `วันที่ทำรายการ (${f(txDate)}) อยู่นอกช่วงวงเงิน CA (${f(ca.start_date)} – ${f(ca.end_date)})`;
  if (!dateWithin(txDate, ca.ma_start_date, ca.ma_end_date))
    return `วันที่ทำรายการ (${f(txDate)}) อยู่นอกช่วงสัญญาแม่ MA (${f(ca.ma_start_date)} – ${f(ca.ma_end_date)})`;
  return null;
}

/** ดึงช่วงวันที่ของ CA + MA จากฐานข้อมูล (แยก 2 query ไม่ใช้ embed) — ใช้ตอน Save */
export async function fetchCaDateItem(caId: string): Promise<CaDateItem | null> {
  const { data: caRow } = await supabase
    .from('credit_agreements')
    .select('start_date, end_date, ma_id')
    .eq('id', caId).maybeSingle();
  if (!caRow) return null;
  let ma_start_date: string | null = null, ma_end_date: string | null = null;
  if ((caRow as any).ma_id) {
    const { data: maRow } = await supabase
      .from('master_agreements')
      .select('start_date, end_date')
      .eq('id', (caRow as any).ma_id).maybeSingle();
    ma_start_date = (maRow as any)?.start_date ?? null;
    ma_end_date = (maRow as any)?.end_date ?? null;
  }
  return {
    id: caId,
    start_date: (caRow as any).start_date ?? null,
    end_date: (caRow as any).end_date ?? null,
    ma_start_date,
    ma_end_date,
  };
}

/** บล็อกตอน Save/ส่งอนุมัติ ถ้าวันทำรายการอยู่นอกช่วงที่ CA/MA ครอบคลุม — โยน Error */
export async function assertCaDateCoverage(
  caId: string | null | undefined,
  txDate: string | null | undefined,
): Promise<void> {
  if (!caId || !txDate) return;
  const item = await fetchCaDateItem(caId);
  const msg = caDateCoverageWarning(item, txDate);
  if (msg) throw new Error(msg);
}
