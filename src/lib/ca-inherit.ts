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
