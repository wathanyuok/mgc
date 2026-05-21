import { fmtDate } from '@/lib/format';

/** Small "created / last edited by" line for detail pages. */
export function AuditFooter({
  createdBy, createdAt, updatedBy, updatedAt,
}: {
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}) {
  if (!createdBy && !updatedBy && !createdAt && !updatedAt) return null;
  const fmtTs = (ts?: string | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${fmtDate(ts)} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
  };
  return (
    <div className="mt-3 text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-0.5">
      {(createdBy || createdAt) && (
        <span>สร้างโดย <strong className="text-gray-600">{createdBy ?? '—'}</strong>{createdAt ? ` · ${fmtTs(createdAt)}` : ''}</span>
      )}
      {(updatedBy || updatedAt) && (
        <span>แก้ไขล่าสุดโดย <strong className="text-gray-600">{updatedBy ?? '—'}</strong>{updatedAt ? ` · ${fmtTs(updatedAt)}` : ''}</span>
      )}
    </div>
  );
}
