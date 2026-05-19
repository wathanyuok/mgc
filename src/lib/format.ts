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

export function fmtDateISO(value: Date | null | undefined) {
  if (!value) return '';
  return value.toISOString().slice(0, 10);
}
