import {
  Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/readonly';

/**
 * SearchableSelect — ช่องเลือกที่ "ค้นหาได้" · ใช้แทน <Select> ได้แบบ drop-in
 *
 * ใช้ API เหมือน Select: value / onChange((e)=>e.target.value) / children เป็น <option>
 *   → เปลี่ยนจาก <Select ...> เป็น <SearchableSelect ...> ได้เลย ไม่ต้องแก้ handler
 * รองรับ <optgroup> (ดึง option ในกลุ่มออกมา) · เคารพโหมด read-only (?view=1) เหมือน Select
 *
 * ใช้กับ dropdown ทั่วไปในหน้า detail · ยกเว้นช่อง "สถานะ" (ยังใช้ Select เดิม)
 */
type Opt = { value: string; label: ReactNode; text: string; disabled?: boolean };

export function SearchableSelect({
  value,
  onChange,
  children,
  disabled,
  className,
  placeholder = '— เลือก —',
  title,
}: {
  value?: string | null;
  onChange?: (e: { target: { value: string } }) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const ro = useReadOnly();
  const isDisabled = !!disabled || ro;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // ดึงรายการตัวเลือกจาก <option> / <optgroup> ที่ส่งมาเป็น children
  const opts = useMemo<Opt[]>(() => {
    const out: Opt[] = [];
    const walk = (nodes: ReactNode) => Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === 'option') {
        const cp: any = child.props;
        const label = cp.children;
        const v = cp.value !== undefined ? String(cp.value) : (typeof label === 'string' ? label : '');
        out.push({ value: v, label, text: typeof label === 'string' ? label : String(v), disabled: cp.disabled });
      } else if (child.type === 'optgroup') {
        walk((child.props as any).children);
      }
    });
    walk(children);
    return out;
  }, [children]);

  const cur = value ?? '';
  const selected = opts.find((o) => o.value === cur);
  const filtered = q.trim()
    ? opts.filter((o) => o.text.toLowerCase().includes(q.trim().toLowerCase()))
    : opts;

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pick = (v: string) => { onChange?.({ target: { value: v } }); setOpen(false); setQ(''); };

  return (
    <div className={cn('relative', className)} ref={boxRef}>
      <button
        type="button"
        disabled={isDisabled}
        title={title}
        onClick={() => !isDisabled && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between rounded border border-line bg-white px-2.5 py-2 text-left text-sm outline-none transition',
          'focus:border-brand focus:ring-2 focus:ring-brand/15',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-muted',
        )}
      >
        <span className={cn('truncate', (!selected || selected.value === '') && 'text-muted')}>
          {selected && selected.value !== '' ? selected.label : placeholder}
        </span>
        <svg className="ml-1 h-4 w-4 shrink-0 text-muted" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && !isDisabled && (
        <div className="absolute z-50 mt-1 w-full rounded border border-line bg-white shadow-lg">
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหา..."
              className="w-full rounded border border-line px-2 py-1 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted">ไม่พบรายการ</div>
            )}
            {filtered.map((o, i) => (
              <button
                type="button"
                key={`${o.value}_${i}`}
                disabled={o.disabled}
                onClick={() => pick(o.value)}
                className={cn(
                  'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-soft disabled:cursor-not-allowed disabled:text-muted',
                  o.value === cur && 'bg-brand/10 font-medium',
                )}
              >
                {o.label === '' ? ' ' : o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
