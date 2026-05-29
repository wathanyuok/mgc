import type { StatusLock } from '@/lib/status-lock';

/**
 * Banner shown at top of TX detail pages when the record is in a
 * terminal or frozen status (read-only / partial lock).
 * No-op when `lock.bannerVariant === 'none'`.
 */
export function StatusLockBanner({ lock }: { lock: StatusLock }) {
  if (lock.bannerVariant === 'none') return null;
  const cls =
    lock.bannerVariant === 'terminal'
      ? 'bg-gray-100 border-gray-300 text-gray-700'
      : 'bg-amber-50 border-amber-200 text-amber-800';
  return (
    <div className={`mb-4 px-4 py-2.5 rounded border text-sm font-medium ${cls}`}>
      {lock.bannerMessage}
    </div>
  );
}
