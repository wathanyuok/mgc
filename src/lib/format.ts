// Number, currency, date formatting helpers used across the Lease module.

export function fmtMoney(value: number | null | undefined, opts: { decimals?: number } = {}) {
  if (value == null || isNaN(value as number)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  });
}

export function fmtPercent(value: number | null | undefined, decimals = 2) {
  if (value == null || isNaN(value as number)) return '-';
  return `${value.toFixed(decimals)}%`;
}

export function fmtDate(value: string | Date | null | undefined) {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** ISO date (YYYY-MM-DD) in LOCAL timezone — avoids the off-by-one shift caused
 *  by Date.toISOString() converting to UTC. Use for storing/displaying calendar
 *  dates in a Bangkok (UTC+7) context. */
export function fmtDateISO(value: Date | null | undefined) {
  if (!value) return '';
  return toLocalISO(value);
}

/** Local-timezone-safe ISO date helper (YYYY-MM-DD). Identical to fmtDateISO
 *  but accepts a Date directly without nullable handling, for use in scheduling
 *  loops where we know the date is valid. */
export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
