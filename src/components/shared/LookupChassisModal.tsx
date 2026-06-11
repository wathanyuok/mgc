import { useState, useEffect } from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input } from '@/components/ui';
import { chassisLookup, checkChassisConflict, type ChassisInventory, type ConflictModule, type ChassisConflict } from '@/lib/chassis-lookup';
import { fmtMoney } from '@/lib/format';

type CommonProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Skip conflict check for the current module being edited */
  excludeModule?: ConflictModule;
  /** Skip conflict check for the current contract being edited */
  excludeContractId?: string;
  /** Hide chassis already added in current form (by chassis_no) */
  excludeChassisNos?: string[];
};

type SingleProps = CommonProps & {
  multi?: false;
  onSelect: (chassis: ChassisInventory) => void;
};

type MultiProps = CommonProps & {
  multi: true;
  onSelect: (chassis: ChassisInventory[]) => void;
};

type Props = SingleProps | MultiProps;

export function LookupChassisModal(props: Props) {
  const { open, onClose, title = 'Lookup Chassis (NetSuite Inventory)', excludeModule, excludeContractId, excludeChassisNos } = props;
  const multi = props.multi === true;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChassisInventory[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [conflictDialog, setConflictDialog] = useState<{
    items: ChassisInventory[];
    conflictMap: Map<string, ChassisConflict[]>;
  } | null>(null);

  // ─── Single-mode pick ─────────────────────────────────
  const tryPickSingle = async (c: ChassisInventory) => {
    const conflicts = await checkChassisConflict(c.chassis_no, excludeModule, excludeContractId);
    if (conflicts.length === 0) {
      (props as SingleProps).onSelect(c);
      onClose();
    } else {
      const map = new Map<string, ChassisConflict[]>();
      map.set(c.id, conflicts);
      setConflictDialog({ items: [c], conflictMap: map });
    }
  };

  // ─── Multi-mode add ───────────────────────────────────
  const tryAddSelected = async () => {
    const picked = results.filter((c) => selectedIds.has(c.id));
    if (picked.length === 0) return;
    const conflictMap = new Map<string, ChassisConflict[]>();
    for (const c of picked) {
      const conflicts = await checkChassisConflict(c.chassis_no, excludeModule, excludeContractId);
      if (conflicts.length > 0) conflictMap.set(c.id, conflicts);
    }
    if (conflictMap.size === 0) {
      (props as MultiProps).onSelect(picked);
      onClose();
    } else {
      setConflictDialog({ items: picked, conflictMap });
    }
  };

  const toggleId = (id: string) =>
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map((c) => c.id)));
    }
  };

  // ─── Force select (skip warning) ───────────────────────
  const forceConfirm = () => {
    if (!conflictDialog) return;
    if (multi) {
      const conflictsCount = conflictDialog.conflictMap.size;
      toast.warning(`เลือก ${conflictDialog.items.length} chassis (${conflictsCount} มี conflict — Force)`);
      (props as MultiProps).onSelect(conflictDialog.items);
    } else {
      const c = conflictDialog.items[0];
      toast.warning(`เลือก ${c.chassis_no} แม้มี conflict (Force)`);
      (props as SingleProps).onSelect(c);
    }
    setConflictDialog(null);
    onClose();
  };

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIds(new Set());
      run('');
    }
  }, [open]);

  const run = async (q: string) => {
    setLoading(true);
    try {
      const r = await chassisLookup({ query: q });
      // Apply excludeChassisNos filter (already-added chassis)
      const filtered = excludeChassisNos && excludeChassisNos.length > 0
        ? r.filter((c) => !excludeChassisNos.includes(c.chassis_no))
        : r;
      setResults(filtered);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const allSelected = results.length > 0 && selectedIds.size === results.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < results.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden"
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
              placeholder="ค้นหา Chassis No / Model / Location"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                run(e.target.value);
              }}
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted mt-1 italic">
            ดึงข้อมูลจาก NetSuite Inventory (ตอนนี้ Mock — รอ Real API)
            {multi && <span className="ml-2 text-brand font-medium">— เลือกได้หลายคัน</span>}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-muted text-sm">กำลังค้นหา...</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">ไม่พบ Chassis ตรงตามคำค้น</div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {multi && (
                    <th className="w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        className="cursor-pointer"
                      />
                    </th>
                  )}
                  <th>Chassis No</th>
                  <th>Engine No</th>
                  <th>Car Model</th>
                  <th>Location</th>
                  <th className="text-right">Cost</th>
                  {!multi && <th />}
                </tr>
              </thead>
              <tbody>
                {results.map((c) => {
                  const checked = selectedIds.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-soft ${checked ? 'bg-brand-light/30' : ''} ${multi ? 'cursor-pointer' : ''}`}
                      onClick={multi ? () => toggleId(c.id) : undefined}
                    >
                      {multi && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleId(c.id)}
                            className="cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="font-mono text-xs">{c.chassis_no}</td>
                      <td className="font-mono text-xs">{c.engine_no}</td>
                      <td className="text-xs">{c.car_model}</td>
                      <td className="text-xs text-muted">{c.location}</td>
                      <td className="text-right tabular-nums text-xs">{fmtMoney(c.cost)}</td>
                      {!multi && (
                        <td>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => tryPickSingle(c)}
                          >
                            Select
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-line bg-soft flex justify-end items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {multi && (
            <Button
              variant="primary"
              size="sm"
              onClick={tryAddSelected}
              disabled={selectedIds.size === 0}
            >
              Add Selected ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Conflict Warning Dialog — per BR-LEASE-026 / BR-LOAN-014 / BR-FP-017 / BR-PN-013 */}
      {conflictDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConflictDialog(null); }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
              <h3 className="text-sm font-semibold text-amber-900">
                Chassis ถูกใช้แล้ว ({conflictDialog.conflictMap.size}/{conflictDialog.items.length})
              </h3>
            </div>
            <div className="px-4 py-3 max-h-[60vh] overflow-y-auto">
              {conflictDialog.items.map((c) => {
                const confs = conflictDialog.conflictMap.get(c.id) ?? [];
                if (confs.length === 0) return null;
                return (
                  <div key={c.id} className="mb-3 pb-3 border-b border-line last:border-b-0 last:mb-0 last:pb-0">
                    <p className="text-sm font-mono mb-1">
                      {c.chassis_no}
                      <span className="ml-2 text-xs text-muted">({c.car_model})</span>
                    </p>
                    <ul className="text-sm space-y-1 ml-2">
                      {confs.map((conf, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="inline-block w-12 text-center text-[10px] font-bold bg-soft border border-line rounded px-1.5 py-0.5">
                            {conf.module}
                          </span>
                          <span className="font-mono">{conf.contract_no}</span>
                          <span className="text-xs text-muted">— {conf.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className="text-[11px] text-amber-700 italic mt-2">
                ⚠️ 1 รถ ใช้ได้กับ 1 Active contract เท่านั้น (ขายซ้ำหรือ collateral พร้อมกันไม่ได้)
              </p>
            </div>
            <div className="px-4 py-3 bg-soft border-t border-line flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConflictDialog(null)}>
                ยกเลิก
              </Button>
              <Button variant="danger" size="sm" onClick={forceConfirm}>
                Force ใช้ต่อ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
