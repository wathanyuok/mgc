// BOT Interest Rate Feed — adapter
// Pulls commercial-bank reference rates (MLR / MOR / MRR / MMR) published by the
// Bank of Thailand (ธปท.) via the BOT API portal (https://apiportal.bot.or.th).
// Dataset: "Loan Interest Rates of Commercial Banks" · endpoint /LoanRate/v2
//
// It is a plain HTTPS REST GET (no VPN / no backend needed) — callable from the
// web/edge directly. When credentials are configured it calls the real BOT API;
// otherwise it falls back to a clearly-labelled SAMPLE set so the flow stays demoable.
import { supabase } from './supabase';

export interface BotRate {
  finance_institution: string;
  interest_type: 'MLR' | 'MOR' | 'MRR' | 'MMR';
  base_rate: number; // % per annum as announced by the bank
  date_effective: string; // ISO date the rate took effect
}

// ── BOT API config (set these in .env — never hardcode secrets) ──
// NEW BOT API platform (มีผล 17 ก.ย. 2568): gateway + Authorization: Bearer token
// สมัคร/ขอ token ที่ Developer Portal: https://portal.api.bot.or.th
//   VITE_BOT_BASE   Gateway base — https://gateway.api.bot.or.th
//   VITE_BOT_TOKEN  Bearer token จาก portal (ส่งใน header Authorization)
const BOT_BASE = import.meta.env.VITE_BOT_BASE ?? 'https://gateway.api.bot.or.th';
const BOT_TOKEN = import.meta.env.VITE_BOT_TOKEN ?? '';
const BOT_LOANRATE_PATH = '/LoanRate/v2';

/** Bank code (BOT) → MGC finance_institution code. Extend as banks are added. */
const BANK_CODE_MAP: Record<string, string> = {
  KKASIKORNBANK: 'KBANK', KBANK: 'KBANK',
  SIAMCOMMERCIALBANK: 'SCB', SCB: 'SCB',
  BANGKOKBANK: 'BBL', BBL: 'BBL',
  KRUNGTHAIBANK: 'KTB', KTB: 'KTB',
};

/**
 * Map the raw BOT /LoanRate/v2 payload → BotRate[].
 * NOTE: verify field names against the real response the first time — BOT's
 * envelope is `{ result: { data: [...] } }`; each row carries a bank + the
 * MLR/MOR/MRR values (either as separate rows or as columns). This handles the
 * "one row per (bank, rate_type)" shape; adjust if BOT returns wide columns.
 */
export function mapBotLoanRateResponse(json: any): BotRate[] {
  const rows: any[] = json?.result?.data ?? json?.data ?? [];
  const out: BotRate[] = [];
  for (const d of rows) {
    const bankRaw = String(d.bank_code ?? d.bank ?? d.bank_name ?? '').toUpperCase().replace(/\s+/g, '');
    const fi = BANK_CODE_MAP[bankRaw] ?? bankRaw;
    const type = String(d.rate_type ?? d.interest_type ?? '').toUpperCase();
    const eff = d.effective_date ?? d.date_effective ?? d.period ?? '';
    if (['MLR', 'MOR', 'MRR', 'MMR'].includes(type) && d.rate != null) {
      out.push({ finance_institution: fi, interest_type: type as BotRate['interest_type'], base_rate: Number(d.rate), date_effective: String(eff) });
    }
  }
  return out;
}

/**
 * Pull current bank reference rates from BOT (/LoanRate/v2).
 * Real HTTPS call when credentials are set; sample snapshot otherwise.
 */
export async function fetchBotInterestRates(): Promise<BotRate[]> {
  // Local-timezone-safe today.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── REAL call — used when a BOT token is configured (new gateway platform) ──
  if (BOT_TOKEN) {
    const res = await fetch(`${BOT_BASE}${BOT_LOANRATE_PATH}`, {
      headers: {
        Authorization: `Bearer ${BOT_TOKEN}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`BOT API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return mapBotLoanRateResponse(json);
  }

  // ── SAMPLE fallback (no credentials) — keeps the sync flow demoable ──
  console.log('🔵 [BOT Feed] no credentials set — using SAMPLE snapshot');
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
 *
 * Supersede-by-DATE (BR-MST-IR-003): เมื่ออัตราเปลี่ยน insert ใบใหม่ (Active,
 * date_effective ใหม่) และ "คงอันเก่าไว้ Active" — อันเก่าเป็นประวัติ สัญญาที่ใช้
 * ไปแล้วอ้างอิงอยู่ · lookupBaseRate() หยิบ date_effective ล่าสุดที่ ≤ วันเป้าหมาย
 * การสลับอัตราจึงเกิดจาก "วันที่" ไม่ใช่การ inactivate · ห้าม inactivate ที่นี่.
 *
 * Idempotent (B1): skip ถ้ามี segment (fi, type, date_effective) เดิม + rate เท่ากันอยู่แล้ว
 * หรืออัตราล่าสุดเท่ากับค่าที่ feed มา · `updated` = จำนวน insert ที่ทับของเก่าด้วยวันที่
 * (ไม่มีแถวไหนถูกปรับเป็น Inactive).
 */
export async function syncBotRatesToMaster(): Promise<{ inserted: number; updated: number; skipped: number }> {
  const feed = await fetchBotInterestRates();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of feed) {
    const { data: existing } = await supabase
      .from('interest_rates')
      .select('id, base_rate, date_effective')
      .eq('finance_institution', r.finance_institution)
      .eq('interest_type', r.interest_type)
      .eq('status', 'Active')
      .order('date_effective', { ascending: false });
    const rows = (existing ?? []) as { id: number; base_rate: number; date_effective: string }[];
    const latest = rows[0];

    // B1 idempotent — segment เดิมถูก sync ไปแล้ว (วันเดียวกัน + rate เท่ากัน).
    const sameSegment = rows.some(
      (x) => x.date_effective === r.date_effective && Number(x.base_rate) === r.base_rate,
    );
    // ไม่เปลี่ยน — อัตราล่าสุดเท่ากับค่าที่ feed มาอยู่แล้ว.
    const unchanged = latest && Number(latest.base_rate) === r.base_rate;
    if (sameSegment || unchanged) {
      skipped++;
      continue;
    }

    // insert อัตราใหม่เป็นแถว Active ใหม่ · ห้าม inactivate อันเก่า —
    // อันเก่าคง Active เป็นประวัติ · lookup สลับด้วย date_effective.
    await supabase.from('interest_rates').insert({
      finance_institution: r.finance_institution,
      interest_type: r.interest_type,
      base_rate: r.base_rate,
      margin: 0,
      effective_rate: r.base_rate,
      date_effective: r.date_effective,
      end_effective_date: null,
      status: 'Active',
      remark: `Synced from BOT /LoanRate/v2${BOT_TOKEN ? '' : ' (sample)'}`,
    });
    inserted++;
    if (latest) updated++; // ทับของเก่าด้วยวันที่ (อันเก่ายังคง Active)
  }

  console.log(`✅ [BOT Feed] synced — inserted ${inserted}, superseded-by-date ${updated} (old kept Active), skipped ${skipped}`);
  return { inserted, updated, skipped };
}
