import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { faLookup, type FixedAsset, type FAType } from '@/lib/fa-lookup';
import { fmtMoney } from '@/lib/format';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (fa: FixedAsset) => void;
  /** Filter results by FA type(s). If omitted, returns all. */
  typeFilter?: FAType | FAType[];
  /** Optional title shown in modal header */
  title?: string;
}

export function LookupFAModal({ open, onClose, onSelect, typeFilter, title = 'Lookup NetSuite FA' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);

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
                        onClick={() => {
                          onSelect(fa);
                          onClose();
                        }}
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
    </div>
  );
}
