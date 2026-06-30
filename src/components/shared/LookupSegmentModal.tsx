// LookupSegmentModal — generic picker for Financial Segment master data
// Per MoM_Loan_Lease_Workshop §6 — แทน input text · ดึงจาก Master Table
// รองรับ 4 segment types: subsidiary · department · location · class
//
// Pattern: เดียวกับ LookupVendorModal · ใช้ Hybrid (auto-default + override)

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input, Badge } from '@/components/ui';
import {
  subsidiaryLookup,
  departmentLookup,
  locationLookup,
  classLookup,
  type Subsidiary,
  type Department,
  type SegmentLocation,
  type Klass,
} from '@/lib/segment-lookup';

export type SegmentType = 'subsidiary' | 'department' | 'location' | 'class';

interface Props {
  open: boolean;
  onClose: () => void;
  segmentType: SegmentType;
  onSelect: (item: { id: string; code: string; name: string }) => void;
  title?: string;
}

const LABELS: Record<SegmentType, { title: string; nsCol: string }> = {
  subsidiary: { title: 'Lookup Subsidiary',   nsCol: 'col 7 Subsidiary' },
  department: { title: 'Lookup Department',   nsCol: 'col 13 Department' },
  location:   { title: 'Lookup Location',     nsCol: 'col 12 Location' },
  class:      { title: 'Lookup Class',        nsCol: 'col 17 Business Type' },
};

export function LookupSegmentModal({
  open,
  onClose,
  segmentType,
  onSelect,
  title,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      runLookup('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, segmentType]);

  const runLookup = async (q: string) => {
    setLoading(true);
    try {
      let r: Array<{ id: string; code: string; name: string }> = [];
      if (segmentType === 'subsidiary')      r = await subsidiaryLookup({ query: q });
      else if (segmentType === 'department') r = await departmentLookup({ query: q });
      else if (segmentType === 'location')   r = await locationLookup({ query: q });
      else if (segmentType === 'class')      r = await classLookup({ query: q });
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const label = LABELS[segmentType];
  const headerTitle = title ?? label.title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div>
            <h3 className="text-base font-semibold">{headerTitle}</h3>
            <p className="text-[11px] text-muted italic">NetSuite GL Segment — {label.nsCol}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink p-1">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-line bg-soft">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
            <Input
              className="pl-8"
              placeholder="ค้นหา Code / Name"
              value={query}
              onChange={(e) => { setQuery(e.target.value); runLookup(e.target.value); }}
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted mt-1 italic">
            ค้นหาจากรายการที่ sync กับ NetSuite
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-muted text-sm">กำลังค้นหา...</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">
              ไม่พบรายการที่ตรงกับเงื่อนไข
            </div>
          ) : (
            <table className="table-base text-sm m-0">
              <thead className="sticky top-0 bg-soft">
                <tr><th>Code</th><th>Name</th><th /></tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={item.id} className="hover:bg-soft cursor-pointer" onClick={() => onSelect(item)}>
                    <td className="font-mono text-xs">{item.code}</td>
                    <td className="font-medium">{item.name}</td>
                    <td className="text-right">
                      <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onSelect(item); }}>
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
          <Button onClick={onClose} variant="ghost" size="sm">ปิด</Button>
        </div>
      </div>
    </div>
  );
}
