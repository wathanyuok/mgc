// โครงรายงานมาตรฐาน — ใช้ร่วมทุกฉบับ
// รับนิยามคอลัมน์ + ข้อมูล แล้วจัดการ ค้นหา · ตัวกรอง · แบ่งหน้า · ส่งออก Excel ให้เอง
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, CalendarDays, X, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card, CardContent, usePaged, Pagination } from '@/components/ui';
import { fmtMoney, fmtDate } from '@/lib/format';

export type ColKind = 'text' | 'money' | 'date' | 'number' | 'percent';

export interface ReportCol<T> {
  key: keyof T & string;
  label: string;
  kind?: ColKind;
  /** แสดงผลเอง — ใช้เมื่อต้องการลิงก์หรือป้ายสี */
  render?: (row: T) => React.ReactNode;
  /** ความกว้างขั้นต่ำ (px) */
  min?: number;
}

/**
 * ตัวกรองตาม Search Conditions ของแบบฟอร์ม
 *   select    — เลือกจากรายการ (สร้างตัวเลือกจากข้อมูลจริงอัตโนมัติ)
 *   text      — พิมพ์คำค้นเฉพาะคอลัมน์นั้น
 *   dateRange — ช่วงวันที่ จาก–ถึง
 */
export interface ReportFilter<T> {
  key: keyof T & string;
  label: string;
  kind?: 'select' | 'text' | 'dateRange';
}

function cellText<T>(row: T, col: ReportCol<T>): string {
  const v: any = (row as any)[col.key];
  if (v == null || v === '') return '';
  switch (col.kind) {
    case 'money': return fmtMoney(Number(v));
    case 'date': return fmtDate(String(v));
    case 'percent': return `${Number(v).toFixed(2)}%`;
    case 'number': return String(v);
    default: return String(v);
  }
}

function rawText<T>(row: T, col: ReportCol<T>): string {
  const v: any = (row as any)[col.key];
  if (v == null) return '';
  return col.kind === 'date' ? fmtDate(String(v)) : String(v);
}

const CTRL = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm outline-none transition ' +
             'placeholder:text-gray-400 hover:border-gray-300 focus:border-brand focus:ring-4 focus:ring-brand/10';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      {children}
    </div>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ช่วงวันที่ — ปุ่มเดียว กดแล้วเปิดแผงเลือก มีทางลัดช่วงที่ใช้บ่อย */
function DateRange({
  label, from, to, onChange,
}: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const has = !!(from || to);
  const text = !has ? 'ทุกช่วงเวลา'
    : from && to ? `${fmtDate(from)} – ${fmtDate(to)}`
    : from ? `ตั้งแต่ ${fmtDate(from)}` : `ถึง ${fmtDate(to)}`;

  const now = new Date();
  const presets: [string, string, string][] = [
    ['30 วันล่าสุด', iso(new Date(now.getTime() - 29 * 86400000)), iso(now)],
    ['90 วันล่าสุด', iso(new Date(now.getTime() - 89 * 86400000)), iso(now)],
    ['เดือนนี้', iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)],
    ['ปีนี้', iso(new Date(now.getFullYear(), 0, 1)), iso(now)],
  ];

  const dateInput = (val: string, set: (v: string) => void) => (
    <input
      type="date" value={val}
      onChange={(e) => set(e.target.value)}
      onMouseDown={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* เปิดอยู่แล้ว */ } }}
      className="h-9 w-full cursor-pointer rounded-lg border border-gray-200 px-2.5 text-sm outline-none
                 transition focus:border-brand focus:ring-4 focus:ring-brand/10"
    />
  );

  return (
    <Field label={label}>
      <div className="relative" ref={box}>
        <button
          type="button" onClick={() => setOpen((o) => !o)}
          className={`${CTRL} flex min-w-[190px] items-center gap-2 ${has ? 'border-brand/40 bg-brand-light/40 text-brand' : 'text-gray-600'}`}
        >
          <CalendarDays size={15} className={has ? 'text-brand' : 'text-gray-400'} />
          <span className="flex-1 text-left">{text}</span>
          {has ? (
            <span
              role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange('', ''); }}
              className="rounded p-0.5 text-brand/70 hover:bg-brand/10 hover:text-brand"
            >
              <X size={13} />
            </span>
          ) : <ChevronDown size={14} className="text-gray-400" />}
        </button>

        {open && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[300px] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">จาก</p>
                {dateInput(from, (v) => onChange(v, to))}
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ถึง</p>
                {dateInput(to, (v) => onChange(from, v))}
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {presets.map(([name, a, b]) => (
                <button
                  key={name} type="button" onClick={() => { onChange(a, b); setOpen(false); }}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 transition hover:border-brand hover:bg-brand-light hover:text-brand"
                >
                  {name}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex justify-between border-t border-gray-100 pt-2.5">
              <button type="button" onClick={() => onChange('', '')}
                className="text-[11px] text-gray-500 transition hover:text-gray-800">ล้าง</button>
              <button type="button" onClick={() => setOpen(false)}
                className="rounded-lg bg-brand px-3 py-1 text-[11px] font-medium text-white transition hover:bg-brand-dark">เสร็จ</button>
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

export function StandardReport<T extends Record<string, any>>({
  title, description, columns, rows, filters = [], searchKeys, isLoading, unit = 'รายการ',
}: {
  title: string;
  description?: string;
  columns: ReportCol<T>[];
  rows: T[];
  filters?: ReportFilter<T>[];
  /** คอลัมน์ที่ช่องค้นหาจะไล่หา — ไม่ระบุ = ค้นทุกคอลัมน์ที่เป็นข้อความ */
  searchKeys?: (keyof T & string)[];
  isLoading?: boolean;
  unit?: string;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<string, string>>({});
  const [txt, setTxt] = useState<Record<string, string>>({});
  const [from, setFrom] = useState<Record<string, string>>({});
  const [to, setTo] = useState<Record<string, string>>({});

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of filters) {
      if ((f.kind ?? 'select') !== 'select') continue;
      out[f.key] = [...new Set(rows.map((r) => String(r[f.key] ?? '')).filter((v) => v && v !== '—'))].sort();
    }
    return out;
  }, [rows, filters]);

  const keys = searchKeys ?? columns.filter((c) => !c.kind || c.kind === 'text').map((c) => c.key);
  const kw = q.trim().toLowerCase();

  const shown = useMemo(() => rows.filter((r) => {
    for (const f of filters) {
      const kind = f.kind ?? 'select';
      const raw = r[f.key];
      if (kind === 'select') {
        const v = sel[f.key];
        if (v && String(raw ?? '') !== v) return false;
      } else if (kind === 'text') {
        const v = (txt[f.key] ?? '').trim().toLowerCase();
        if (v && !String(raw ?? '').toLowerCase().includes(v)) return false;
      } else {
        const d = raw ? String(raw).slice(0, 10) : '';
        const a = from[f.key]; const b = to[f.key];
        if ((a || b) && !d) return false;
        if (a && d < a) return false;
        if (b && d > b) return false;
      }
    }
    if (!kw) return true;
    return keys.some((k) => String(r[k] ?? '').toLowerCase().includes(kw));
  }), [rows, filters, sel, txt, from, to, kw, keys]);

  const pg = usePaged(shown, 50);
  const hasFilter = !!kw || [sel, txt, from, to].some((m) => Object.values(m).some(Boolean));
  const clearAll = () => { setQ(''); setSel({}); setTxt({}); setFrom({}); setTo({}); };

  const exportExcel = () => {
    const data = shown.map((r) => {
      const o: Record<string, any> = {};
      for (const c of columns) {
        const v = r[c.key];
        o[c.label] = c.kind === 'money' || c.kind === 'number' || c.kind === 'percent'
          ? (v == null ? '' : Number(v))
          : rawText(r, c);
      }
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = columns.map((c) => ({ wch: Math.min(Math.max(c.label.length + 4, 12), 40) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30));
    XLSX.writeFile(wb, `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // แถวรวมท้ายตาราง — เฉพาะคอลัมน์จำนวนเงิน
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) {
      if (c.kind !== 'money') continue;
      t[c.key] = shown.reduce((s, r) => s + Number(r[c.key] ?? 0), 0);
    }
    return t;
  }, [shown, columns]);
  const hasTotals = Object.keys(totals).length > 0;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="space-y-2.5 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">{title}</p>
              {description && <p className="text-[11px] text-muted">{description}</p>}
            </div>
            <button
              type="button" onClick={exportExcel} disabled={shown.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-medium
                         text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} /> ส่งออก Excel
            </button>
          </div>

          <div className="rounded-xl bg-gray-50/70 p-3">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
              <Field label="Search">
                <input
                  value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search..."
                  className={CTRL + ' w-52'}
                />
              </Field>

              {filters.map((f) => {
                const kind = f.kind ?? 'select';
                if (kind === 'select') {
                  if (!options[f.key] || options[f.key].length < 2) return null;
                  const active = !!sel[f.key];
                  return (
                    <Field key={f.key} label={f.label}>
                      <select
                        value={sel[f.key] ?? ''}
                        onChange={(e) => setSel((s) => ({ ...s, [f.key]: e.target.value }))}
                        className={`${CTRL} min-w-[130px] cursor-pointer ${active ? 'border-brand/40 bg-brand-light/40 font-medium text-brand' : 'text-gray-700'}`}
                      >
                        <option value="">All</option>
                        {options[f.key].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </Field>
                  );
                }
                if (kind === 'text') {
                  return (
                    <Field key={f.key} label={f.label}>
                      <input
                        value={txt[f.key] ?? ''}
                        onChange={(e) => setTxt((s) => ({ ...s, [f.key]: e.target.value }))}
                        placeholder="Search..."
                        className={CTRL + ' w-44'}
                      />
                    </Field>
                  );
                }
                return (
                  <DateRange
                    key={f.key} label={f.label}
                    from={from[f.key] ?? ''} to={to[f.key] ?? ''}
                    onChange={(a, b) => {
                      setFrom((s) => ({ ...s, [f.key]: a }));
                      setTo((s) => ({ ...s, [f.key]: b }));
                    }}
                  />
                );
              })}

              {hasFilter && (
                <button
                  type="button" onClick={clearAll}
                  className="h-9 self-end rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  ล้างตัวกรองทั้งหมด
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-base whitespace-nowrap text-xs">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.kind === 'money' || c.kind === 'number' || c.kind === 'percent' ? 'text-right' : ''}
                      style={c.min ? { minWidth: c.min } : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {columns.map((c) => (
                    <td key={c.key} className={c.kind === 'money' || c.kind === 'number' || c.kind === 'percent' ? 'text-right tabular-nums' : ''}>
                      {c.render ? c.render(r) : cellText(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
              {!isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="py-8 text-center text-muted">
                    {rows.length > 0 ? 'ไม่พบรายการตามเงื่อนไขที่เลือก' : 'ยังไม่มีข้อมูล'}
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr><td colSpan={columns.length} className="py-8 text-center text-muted">กำลังโหลด...</td></tr>
              )}
            </tbody>
            {hasTotals && shown.length > 0 && (
              <tfoot>
                <tr className="bg-soft font-semibold">
                  {columns.map((c, i) => (
                    <td key={c.key} className={c.kind === 'money' ? 'text-right tabular-nums' : ''}>
                      {i === 0 ? 'รวม' : (c.kind === 'money' ? fmtMoney(totals[c.key]) : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Pagination {...pg} unit={unit} />
      </CardContent>
    </Card>
  );
}
