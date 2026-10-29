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

/**
 * จำนวนทศนิยมของอัตราดอกเบี้ย — ล้อตามความละเอียดของค่าจริง (ขั้นต่ำ 2 สูงสุด 4)
 * ปัดเป็น 4 ตำแหน่งก่อนนับ เพื่อตัด noise ของ floating point (เช่น 0.1+0.2)
 * ใช้ให้ EFFECTIVE RATE ทุกหน้าแสดงตรงกับ BASE+MARGIN ที่กรอก (2.3333+2.3333 → 4.6666%)
 */
export function rateDp(value: number | null | undefined): number {
  const r = Math.round(((value ?? 0) as number) * 10000) / 10000;
  const s = String(r); const i = s.indexOf('.');
  return i < 0 ? 2 : Math.min(4, Math.max(2, s.length - i - 1));
}

export function fmtDate(value: string | Date | null | undefined) {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '-';
  // แสดงเป็น วัน/เดือน/ปี เลขล้วน (DD/MM/YYYY) ให้ตรงกับช่องกรอกวันที่ทั้งระบบ
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
