import { cn } from '../../lib/cn';

interface CharCountProps {
  /** ข้อความที่ผู้ใช้พิมพ์อยู่ตอนนี้ */
  value?: string | null;
  /** จำนวนตัวอักษรสูงสุดของช่องนั้น */
  max: number;
  /** ซ่อนไว้จนกว่าจะพิมพ์ถึงกี่ % ของเพดาน · 0 = แสดงตลอด (ค่าเริ่มต้น) */
  showAt?: number;
  className?: string;
}

/**
 * ตัวนับตัวอักษรใต้ช่องกรอก
 * แสดงตลอดเวลา สีจางไว้ไม่ให้แย่งสายตา
 * ใกล้เต็ม (80%) เปลี่ยนเป็นสีส้ม · เต็มแล้วบอกว่าพิมพ์ต่อไม่ได้
 */
export function CharCount({ value, max, showAt = 0, className }: CharCountProps) {
  const len = String(value ?? '').length;
  if (showAt > 0 && len < max * showAt) return null;
  const full = len >= max;
  const near = len >= max * 0.8;
  return (
    <div
      className={cn(
        'mt-1 text-right text-[11px] tabular-nums',
        full ? 'font-medium text-amber-600' : near ? 'text-amber-600' : 'text-gray-400',
        className,
      )}
    >
      {len.toLocaleString()} / {max.toLocaleString()}
      {full && ' · พิมพ์ต่อไม่ได้แล้ว'}
    </div>
  );
}
