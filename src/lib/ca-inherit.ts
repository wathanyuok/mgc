import { supabase } from '@/lib/supabase';

/**
 * Fetch a Credit Agreement's default Rate Cards + Accounting Cards.
 * Used so that a transaction created under a CA inherits the CA's
 * Interest Rate (rate_cards) and Accounting (acct_cards) as editable defaults
 *.
 */
export async function fetchCaCards(
  caId: string,
): Promise<{ rate_cards: any[]; acct_cards: any[]; fi: string }> {
  const { data } = await supabase
    .from('credit_agreements')
    .select('rate_cards, acct_cards, finance_institution')
    .eq('id', caId)
    .maybeSingle();
  return {
    rate_cards: ((data as any)?.rate_cards as any[]) ?? [],
    acct_cards: ((data as any)?.acct_cards as any[]) ?? [],
    // สถาบันการเงินของวงเงิน — รายการธุรกรรมต้องใช้ธนาคารเดียวกับวงเงินเสมอ
    fi: ((data as any)?.finance_institution as string) ?? '',
  };
}
