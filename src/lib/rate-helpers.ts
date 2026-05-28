// Helpers for selecting effective rate from multiple rate cards.
// Supports Fix + Float; the schedule
// picks the card whose start_date ≤ period date and is the most recent.

import type { RateCard } from '@/components/tx/RateCards';

export interface EffectiveRateResult {
  rate: number; // effective % = base + condition
  baseRate: number; // raw rate (before spread)
  spread: number; // condition spread
  type: string; // Fixed / MLR / MMR / MOR / MRR
  card: RateCard | null;
}

/**
 * Pick the rate card effective on a given date.
 * - Sorts cards by start_date ascending
 * - Returns the card with the latest start_date that is ≤ targetDate
 * - If no cards have start_date set, falls back to first card
 * - If targetDate is before earliest start_date, falls back to first card
 */
export function pickEffectiveRate(
  rateCards: RateCard[] | undefined,
  targetDate: string | null,
): EffectiveRateResult {
  if (!rateCards || rateCards.length === 0) {
    return { rate: 0, baseRate: 0, spread: 0, type: 'Fixed', card: null };
  }
  // Sort by start_date asc (null/empty first)
  const sorted = [...rateCards].sort((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;
    return a.start_date.localeCompare(b.start_date);
  });

  let chosen: RateCard = sorted[0];
  if (targetDate) {
    // Find latest card with start_date ≤ targetDate
    for (const card of sorted) {
      if (!card.start_date) continue;
      if (card.start_date <= targetDate) chosen = card;
      else break;
    }
  }

  const rate = (chosen.rate || 0) + (chosen.condition || 0);
  return {
    rate,
    baseRate: chosen.rate || 0,
    spread: chosen.condition || 0,
    type: chosen.type,
    card: chosen,
  };
}

/**
 * Total interest across the contract using multi-rate schedule.
 * Approximation: integrates rate over time by walking month-end boundaries.
 */
export function calcTotalInterestMultiRate(
  principal: number,
  rateCards: RateCard[],
  startDate: string,
  endDate: string,
): number {
  if (!principal || !rateCards || rateCards.length === 0) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end <= start) return 0;

  let total = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    // Find next month-end OR rate change boundary
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const periodEnd = monthEnd > end ? end : monthEnd;
    const days = Math.round((periodEnd.getTime() - cursor.getTime()) / 86400000);
    // Local-timezone-safe ISO — UTC shift would pick the wrong rate at month boundaries.
    const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const { rate } = pickEffectiveRate(rateCards, dateStr);
    total += (principal * rate * days) / 100 / 365;
    cursor = new Date(periodEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return parseFloat(total.toFixed(2));
}
