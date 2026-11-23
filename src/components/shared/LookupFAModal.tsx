import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { faLookup, type FixedAsset, type FAType } from '@/lib/fa-lookup';
import { fmtMoney } from '@/lib/format';

export interface FAConflict { lease_no: string; status: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (fa: FixedAsset) => void;
  /** Filter results by FA type(s). If omitted, returns all. */
  typeFilter?: FAType | FAType[];
  /** Optional title shown in modal header */
  title?: string;
  /** ตรวจสินทรัพย์ซ้ำตอนกดเลือก (เหมือน Lookup Chassis) — คืน blockers(มีผลแล้ว)/warnings(ร่าง/รออนุมัติ) */
  checkConflict?: (fa: FixedAsset) => Promise<{ blockers: FAConflict[]; warnings: FAConflict[] }>;
}

export function LookupFAModal({ open, onClose, onSelect, typeFilter, title = 'Lookup NetSuite FA', checkConflict }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ fa: FixedAsset; blockers: FAConflict[]; warnings: FAConflict[] } | null>(null);

  const pick = async (fa: FixedAsset) => {
    if (checkConflict) {
      const { blockers, warnings } = await checkConflict(fa);
      if (blockers.length > 0 || warnings.length > 0) {
        setPending({ fa, blockers, warnings });
        return;
      }
    }
    onSelect(fa);
    onClose();
  };

  // Initial load on open
  useEffect(() => {
    if (open) {
      setQuery('');
      runLookup('');
    }
  }, [open]);

  const runLookup = async (q: string) => {
    setLoading(true);
    try {
      const r = await faLookup({ query: q, type: typeFilter });
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink p-1">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-line bg-soft">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
            <Input
              className="pl-8"
              placeholder="ค้นหา Asset No / Description / ทะเบียนรถ / Chassis"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                runLookup(e.target.value);
              }}
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted mt-1 italic">
            ดึงข้อมูลจาก NetSuite Fixed Asset Master (ตอนนี้ Mock — รอ Real API)
          </p>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-muted text-sm">กำลังค้นหา...</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">ไม่พบ Asset ตรงตามคำค้น</div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>Asset No</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th className="text-right">Book Value</th>
                  <th>Location</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((fa) => (
                  <tr key={fa.asset_no} className="hover:bg-soft">
                    <td className="font-mono text-xs">{fa.asset_no}</td>
                    <td className="text-xs">{fa.description}</td>
                    <td className="text-xs">{fa.type}</td>
                    <td className="text-right tabular-nums text-xs">{fmtMoney(fa.book_value)}</td>
                    <td className="text-xs text-muted">{fa.location ?? '—'}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => pick(fa)}
                      >
                        Select
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-line bg-soft text-right">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Conflict dialog — สินทรัพย์ซ้ำกับสัญญาเช่าอื่น (เหมือน Lookup Chassis) */}
      {pending && (() => {
        const hasBlocker = pending.blockers.length > 0;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setPending(null); }}>
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className={`px-4 py-3 border-b text-sm font-semibold ${hasBlocker ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                {hasBlocker ? '🚫 สินทรัพย์นี้ถูกใช้ในสัญญาเช่าที่มีผลแล้ว — เลือกไม่ได้' : '⚠️ สินทรัพย์นี้ถูกใช้ในสัญญาเช่าอื่นอยู่'}
              </div>
              <div className="px-4 py-3 text-sm">
                <p className="font-mono mb-2">{pending.fa.asset_no} · {pending.fa.description}</p>
                <ul className="space-y-1">
                  {[...pending.blockers, ...pending.warnings].map((c, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${pending.blockers.includes(c) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                        {c.status}
                      </span>
                      <span className="font-mono">{c.lease_no}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="px-4 py-3 bg-soft border-t border-line flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPending(null)}>ยกเลิก</Button>
                {!hasBlocker && (
                  <Button variant="primary" size="sm" onClick={() => { onSelect(pending.fa); setPending(null); onClose(); }}>
                    เลือกต่อ
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
