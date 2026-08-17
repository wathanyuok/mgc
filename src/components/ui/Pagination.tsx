// แบ่งหน้ารายการ — ใช้ร่วมกันทุกหน้า List
//
// วิธีใช้:
//   const pg = usePaged(data);          // data = อาร์เรย์ที่กรองแล้ว
//   {pg.rows.map(...)}                  // แทนที่ data.map(...)
//   <Pagination {...pg} />              // วางใต้ตาราง
//
// เป็นการแบ่งหน้าฝั่งหน้าจอ (ข้อมูลโหลดมาครบแล้วค่อยตัดเป็นหน้า)
// เพียงพอสำหรับปริมาณระดับพันรายการ · ถ้าโตกว่านั้นค่อยย้ายไปแบ่งหน้าที่ฐานข้อมูล

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export interface Paged<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
  size: number;
  from: number;
  to: number;
  setPage: (p: number) => void;
  setSize: (s: number) => void;
}

export function usePaged<T>(all: T[] | undefined, defaultSize = 25): Paged<T> {
  const list = all ?? [];
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(defaultSize);

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);

  // เปลี่ยนตัวกรองแล้วจำนวนรายการเปลี่ยน → กลับไปหน้าแรก
  useEffect(() => { setPage(1); }, [total, size]);

  const rows = useMemo(
    () => list.slice((current - 1) * size, current * size),
    [list, current, size],
  );

  return {
    rows, page: current, totalPages, total, size,
    from: total === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(current * size, total),
    setPage, setSize,
  };
}

/** เลขหน้าแบบย่อ เช่น 1 … 4 5 6 … 20 */
function pageNumbers(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push('…');
  out.push(totalPages);
  return out;
}

export function Pagination<T>({
  page, totalPages, total, size, from, to, setPage, setSize,
  unit = 'รายการ',
}: Paged<T> & { unit?: string }) {
  if (total === 0) return null;

  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-gray-200 px-2 text-sm transition';

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-sm">
      <span className="text-muted">
        แสดง <span className="font-medium text-gray-700 tabular-nums">{from}–{to}</span> จาก{' '}
        <span className="font-medium text-gray-700 tabular-nums">{total}</span> {unit}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-muted text-xs">ต่อหน้า</span>
        <select
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-brand"
        >
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button" disabled={page === 1} onClick={() => setPage(page - 1)}
            className={`${btn} ${page === 1 ? 'cursor-not-allowed text-gray-300' : 'text-gray-600 hover:bg-gray-50'}`}
            aria-label="หน้าก่อนหน้า"
          >
            <ChevronLeft size={15} />
          </button>

          {pageNumbers(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-gray-400">…</span>
            ) : (
              <button
                key={p} type="button" onClick={() => setPage(p)}
                className={`${btn} ${p === page
                  ? 'border-brand bg-brand-light font-medium text-brand'
                  : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {p}
              </button>
            ),
          )}

          <button
            type="button" disabled={page === totalPages} onClick={() => setPage(page + 1)}
            className={`${btn} ${page === totalPages ? 'cursor-not-allowed text-gray-300' : 'text-gray-600 hover:bg-gray-50'}`}
            aria-label="หน้าถัดไป"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
