// LookupVendorModal — pick a vendor from NetSuite Vendor Master
// Per MoM Interface §3 + §5 (Lessor / Bank / Supplier / Customer)
// Phase 1: stub data from local vendors table · Phase 2: real NetSuite Lookup API

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input, Badge } from '@/components/ui';
import { vendorLookup } from '@/lib/vendor-lookup';
import type { Vendor, VendorType } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (v: Vendor) => void;
  /** Filter by type(s) — e.g., 'lessor' for IFRS 16 Lease form */
  typeFilter?: VendorType | VendorType[];
  title?: string;
}

const typeColor: Record<string, 'brand' | 'success' | 'warn' | 'default'> = {
  bank: 'brand',
  lessor: 'success',
  dealer: 'warn',
  supplier: 'warn',
  importer: 'warn',
  customer: 'default',
};

export function LookupVendorModal({
  open,
  onClose,
  onSelect,
  typeFilter,
  title = 'Lookup NetSuite Vendor',
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      runLookup('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runLookup = async (q: string) => {
    setLoading(true);
    try {
      const r = await vendorLookup({ query: q, type: typeFilter });
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink p-1">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-line bg-soft">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
            <Input
              className="pl-8"
              placeholder="ค้นหา Code / Name / Tax ID / NetSuite Vendor ID"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                runLookup(e.target.value);
              }}
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted mt-1 italic">
            ดึงข้อมูลจาก NetSuite Vendor Master
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-muted text-sm">กำลังค้นหา...</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">
              ไม่พบ vendor ที่ตรงกับเงื่อนไข
            </div>
          ) : (
            <table className="table-base text-sm m-0">
              <thead className="sticky top-0 bg-soft">
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Tax ID</th>
                  <th>NetSuite ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((v) => (
                  <tr key={v.id} className="hover:bg-soft cursor-pointer" onClick={() => onSelect(v)}>
                    <td className="font-mono text-xs">{v.code}</td>
                    <td className="font-medium">{v.name}</td>
                    <td>
                      {v.vendor_type ? (
                        <Badge variant={typeColor[v.vendor_type] ?? 'default'}>{v.vendor_type}</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-xs">{v.tax_id ?? <span className="text-muted">—</span>}</td>
                    <td className="text-xs font-mono">
                      {v.netsuite_vendor_id ?? (
                        <Badge variant="warn" className="text-[10px]">
                          ⏳ ยังไม่ map
                        </Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(v);
                        }}
                      >
                        เลือก
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t border-line bg-soft flex justify-end">
          <Button onClick={onClose} variant="ghost" size="sm">
            ปิด
          </Button>
        </div>
      </div>
    </div>
  );
}
