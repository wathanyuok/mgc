import { supabase } from '@/lib/supabase';

/**
 * Fetch a Credit Agreement's default Rate Cards + Accounting Cards.
 * Used so that a transaction created under a CA inherits the CA's
 * Interest Rate (rate_cards) and Accounting (acct_cards) as editable defaults
 * (MoM intent: CA defines the standard terms; the transaction may override).
 */
export async function fetchCaCards(
  caId: string,
): Promise<{ rate_cards: any[]; acct_cards: any[] }> {
  const { data } = await supabase
    .from('credit_agreements')
    .select('rate_cards, acct_cards')
    .eq('id', caId)
    .maybeSingle();
  return {
    rate_cards: ((data as any)?.rate_cards as any[]) ?? [],
    acct_cards: ((data as any)?.acct_cards as any[]) ?? [],
  };
}
