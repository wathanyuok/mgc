// BOT Interest Rate Feed — adapter (STUB, Phase 3 placeholder)
//
// In production this pulls commercial-bank reference rates (MLR / MOR / MRR / MMR)
// published by the Bank of Thailand (ธปท.) via the BOT API portal
// (https://apiportal.bot.or.th — dataset "Interest Rates of Commercial Banks").
// Each bank sets its own MLR/MOR/MRR; BOT aggregates + publishes them.
//
// For now `fetchBotInterestRates()` returns a clearly-labelled SAMPLE set + logs.
// When MGC obtains a BOT API client-id/secret, swap the body with the real call.
import { supabase } from './supabase';

export interface BotRate {
  finance_institution: string;
  interest_type: 'MLR' | 'MOR' | 'MRR' | 'MMR';
  base_rate: number;     // % per annum as announced by the bank
  date_effective: string; // ISO date the rate took effect
}

/**
 * Pull current bank reference rates from BOT.
 * STUB: returns a sample snapshot (clearly tagged). Replace with the real
 * BOT API call once credentials are available — see commented block below.
 */
export async function fetchBotInterestRates(): Promise<BotRate[]> {
  const today = new Date().toISOString().slice(0, 10);

  // ── REAL implementation (when BOT API credentials available) ──
  // const res = await fetch(`${BOT_BASE}/InterestRates/CommercialBanks?...`, {
  //   headers: { 'X-IBM-Client-Id': BOT_CLIENT_ID, 'X-IBM-Client-Secret': BOT_SECRET, accept: 'application/json' },
  // });
  // if (!res.ok) throw new Error(`BOT API ${res.status}: ${await res.text()}`);
  // const json = await res.json();
  // return json.result.data.map((d: any) => ({ finance_institution: d.bank_code, interest_type: d.rate_type, base_rate: Number(d.rate), date_effective: d.effective_date }));

  // ── STUB sample (so the sync flow is demonstrable) ──
  console.log('🔵 [BOT Feed Stub] fetching commercial-bank reference rates…');
  await new Promise((r) => setTimeout(r, 400));
  return [
    { finance_institution: 'KBANK', interest_type: 'MLR', base_rate: 7.27, date_effective: today },
    { finance_institution: 'KBANK', interest_type: 'MOR', base_rate: 7.59, date_effective: today },
    { finance_institution: 'KBANK', interest_type: 'MRR', base_rate: 7.30, date_effective: today },
    { finance_institution: 'SCB', interest_type: 'MLR', base_rate: 7.30, date_effective: today },
    { finance_institution: 'SCB', interest_type: 'MOR', base_rate: 7.575, date_effective: today },
    { finance_institution: 'SCB', interest_type: 'MRR', base_rate: 7.30, date_effective: today },
    { finance_institution: 'BBL', interest_type: 'MLR', base_rate: 7.00, date_effective: today },
    { finance_institution: 'BBL', interest_type: 'MOR', base_rate: 7.55, date_effective: today },
    { finance_institution: 'BBL', interest_type: 'MRR', base_rate: 7.05, date_effective: today },
    { finance_institution: 'KTB', interest_type: 'MLR', base_rate: 7.025, date_effective: today },
    { finance_institution: 'KTB', interest_type: 'MOR', base_rate: 7.57, date_effective: today },
    { finance_institution: 'KTB', interest_type: 'MRR', base_rate: 7.32, date_effective: today },
  ];
}

/**
 * Sync the BOT feed into the Interest Rate master.
 * Per master convention: when a rate changes, the previous Active record is
 * Inactivated (end-dated) and a new Active record is inserted. Idempotent —
 * skips when the latest Active record already has the same base_rate.
 */
export async function syncBotRatesToMaster(): Promise<{ inserted: number; updated: number; skipped: number }> {
  const feed = await fetchBotInterestRates();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of feed) {
    const { data: existing } = await supabase
      .from('interest_rates')
      .select('id, base_rate')
      .eq('finance_institution', r.finance_institution)
      .eq('interest_type', r.interest_type)
      .eq('status', 'Active');
    const active = (existing ?? [])[0] as { id: number; base_rate: number } | undefined;

    if (active && Number(active.base_rate) === r.base_rate) {
      skipped++;
      continue;
    }
    if (active) {
      await supabase
        .from('interest_rates')
        .update({ status: 'Inactive', end_effective_date: r.date_effective })
        .eq('id', active.id);
      updated++;
    }
    await supabase.from('interest_rates').insert({
      finance_institution: r.finance_institution,
      interest_type: r.interest_type,
      base_rate: r.base_rate,
      margin: 0,
      effective_rate: r.base_rate,
      date_effective: r.date_effective,
      end_effective_date: null,
      status: 'Active',
      remark: 'Synced from BOT feed (stub)',
    });
    inserted++;
  }

  console.log(`✅ [BOT Feed Stub] synced — inserted ${inserted}, superseded ${updated}, skipped ${skipped}`);
  return { inserted, updated, skipped };
}
