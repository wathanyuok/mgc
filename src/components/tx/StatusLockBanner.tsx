import type { StatusLock } from '@/lib/status-lock';

/**
 * Banner shown at top of TX detail pages when the record is in a
 * terminal or frozen status (read-only / partial lock).
 * No-op when `lock.bannerVariant === 'none'`.
 *
 * Color mapping:
 * - Terminal (Closed/Cancelled/...) → gray  (neutral, "closed")
 * - Frozen + Repaid                 → emerald (positive, "happy ending")
 * - Frozen + Suspended/other        → amber  (caution, "pay attention")
 */
export function StatusLockBanner({ lock }: { lock: StatusLock }) {
  if (lock.bannerVariant === 'none') return null;
  let cls = 'bg-gray-100 border-gray-300 text-gray-700';
  if (lock.bannerVariant === 'frozen') {
    cls = lock.bannerMessage.startsWith('✅')
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-amber-50 border-amber-200 text-amber-800';
  }
  return (
    <div className={`mb-4 px-4 py-2.5 rounded border text-sm font-medium ${cls}`}>
      {lock.bannerMessage}
    </div>
  );
}
