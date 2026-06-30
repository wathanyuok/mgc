import { useState, useEffect } from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input } from '@/components/ui';
import { chassisLookup, checkChassisConflict, classifyConflicts, type ChassisInventory, type ConflictModule, type ChassisConflict } from '@/lib/chassis-lookup';
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
  /** Caller form's finance_institution — used for MoM Option B same-bank=BLOCK vs different-bank=WARN */
  currentBank?: string | null;
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
  const { open, onClose, title = 'Lookup Chassis (NetSuite Inventory)', excludeModule, excludeContractId, excludeChassisNos, currentBank } = props;
  const multi = props.multi === true;

  const [query, setQuery] = useState('');
  const [filterBrand, setFilterBrand] = useState<string>('');     // A4: filter by brand (extracted from model)
  const [filterLocation, setFilterLocation] = useState<string>(''); // A4: filter by location
  const [results, setResults] = useState<ChassisInventory[]>([]);
  const [allResults, setAllResults] = useState<ChassisInventory[]>([]);  // unfiltered (for dropdown options)
  const [hasMore, setHasMore] = useState(false);  // server returned partial · user must refine search
  const [totalCount, setTotalCount] = useState(0); // total matching (before limit)
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const PAGE_LIMIT = 50;

  // ─── A4 (MoM Open #9): Filter dimensions extracted from data ─────────
  const brandFromModel = (model: string): string => {
    const m = model.split(/\s+/);
    return m[0] || '';  // "BMW 320i M Sport" → "BMW"
  };
  const availableBrands = Array.from(new Set(allResults.map((c) => brandFromModel(c.car_model)).filter(Boolean))).sort();
  const availableLocations = Array.from(new Set(allResults.map((c) => c.location).filter(Boolean))).sort();
  const [conflictDialog, setConflictDialog] = useState<{
    items: ChassisInventory[];
    conflictMap: Map<string, ChassisConflict[]>;
  } | null>(null);

  // ─── Single-mode pick ─────────────────────────────────
  // Per MoM Option B: same-bank conflicts = BLOCK (no force), different-bank = WARN (force allowed)
  const tryPickSingle = async (c: ChassisInventory) => {
    const conflicts = await checkChassisConflict(c.chassis_no, excludeModule, excludeContractId, currentBank);
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
      const conflicts = await checkChassisConflict(c.chassis_no, excludeModule, excludeContractId, currentBank);
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
      setFilterBrand('');
      setFilterLocation('');
      setSelectedIds(new Set());
      run('');
    }
  }, [open]);

  // Re-apply client-side brand/location filter when filter dropdown changes
  useEffect(() => {
    let r = allResults;
    if (filterBrand) r = r.filter((c) => brandFromModel(c.car_model) === filterBrand);
    if (filterLocation) r = r.filter((c) => c.location === filterLocation);
    if (excludeChassisNos && excludeChassisNos.length > 0) {
      r = r.filter((c) => !excludeChassisNos.includes(c.chassis_no));
    }
    setResults(r);
    // Clear stale selections that are no longer visible
    setSelectedIds((s) => {
      const visible = new Set(r.map((x) => x.id));
      const next = new Set<string>();
      s.forEach((id) => { if (visible.has(id)) next.add(id); });
      return next;
    });
  }, [allResults, filterBrand, filterLocation]);

  const run = async (q: string) => {
    setLoading(true);
    try {
      const { rows, total, hasMore: more } = await chassisLookup({ query: q, limit: PAGE_LIMIT, offset: 0 });
      setAllResults(rows);
      setTotalCount(total);
      setHasMore(more);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const { rows, total, hasMore: more } = await chassisLookup({
        query, limit: PAGE_LIMIT, offset: allResults.length,
      });
      setAllResults((prev) => [...prev, ...rows]);
      setTotalCount(total);
      setHasMore(more);
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

        <div className="px-4 py-3 border-b border-line bg-soft space-y-2">
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
          {/* A4 (MoM Open #9): Filter Criteria — Brand · Location */}
          <div className="flex gap-2 items-center text-xs">
            <label className="text-muted">กรอง:</label>
            <select
              className="border border-line rounded px-2 py-1 bg-white"
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
            >
              <option value="">ทุกยี่ห้อ</option>
              {availableBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              className="border border-line rounded px-2 py-1 bg-white"
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
            >
              <option value="">ทุกสาขา</option>
              {availableLocations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            {(filterBrand || filterLocation) && (
              <button
                onClick={() => { setFilterBrand(''); setFilterLocation(''); }}
                className="text-brand-700 hover:underline ml-1"
              >
                ล้างกรอง
              </button>
            )}
            <span className="ml-auto text-muted">
              แสดง <strong className="text-ink">{results.length}</strong> · โหลดมาแล้ว <strong className="text-ink">{allResults.length}</strong>
              {totalCount > 0 && <> · ทั้งหมด <strong className="text-ink">{totalCount.toLocaleString()}</strong> คัน</>}
            </span>
          </div>
          <p className="text-[11px] text-muted italic">
            โหลดทีละ {PAGE_LIMIT} คัน · ใส่คำค้น (chassis no / model / location) เพื่อจำกัดผลลัพธ์ · หรือกด "โหลดเพิ่ม" ด้านล่างตาราง
            {multi && <span className="ml-2 text-brand font-medium">· เลือกได้หลายคัน</span>}
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

          {/* Load more — appears when server has more rows beyond current limit */}
          {hasMore && !loading && (
            <div className="p-3 text-center border-t border-line bg-soft/40">
              <Button size="sm" variant="outline" onClick={loadMore}>
                ⬇ โหลดเพิ่ม {PAGE_LIMIT} คัน (เหลือ {(totalCount - allResults.length).toLocaleString()} คัน)
              </Button>
              <p className="text-[10px] text-muted mt-1 italic">
                หรือใส่คำค้นด้านบนเพื่อกรองให้แคบลง
              </p>
            </div>
          )}
          {!hasMore && allResults.length > 0 && !loading && (
            <div className="p-2 text-center text-[10px] text-muted italic border-t border-line bg-soft/40">
              ✓ โหลดครบ {allResults.length.toLocaleString()} คันแล้ว
            </div>
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
      {/* MoM Option B: same-bank = BLOCK (no force), different-bank = WARN (force ok) */}
      {conflictDialog && (() => {
        // Classify all conflicts: any same-bank blocker → cannot force
        const allConflicts: ChassisConflict[] = [];
        conflictDialog.conflictMap.forEach((cs) => allConflicts.push(...cs));
        const { blockers, warnings: warnConfs } = classifyConflicts(allConflicts);
        const hasBlocker = blockers.length > 0;
        return (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConflictDialog(null); }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${hasBlocker ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <AlertTriangle className={`w-5 h-5 ${hasBlocker ? 'text-red-700' : 'text-amber-700'}`} />
              <h3 className={`text-sm font-semibold ${hasBlocker ? 'text-red-900' : 'text-amber-900'}`}>
                {hasBlocker ? 'Chassis ซ้ำกับสัญญา Active ของแบงก์เดียวกัน — ใช้ต่อไม่ได้' : `Chassis ถูกใช้แล้ว (${conflictDialog.conflictMap.size}/${conflictDialog.items.length})`}
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
                          <span className={`inline-block w-12 text-center text-[10px] font-bold border rounded px-1.5 py-0.5 ${conf.same_bank ? 'bg-red-100 border-red-300 text-red-800' : 'bg-soft border-line'}`}>
                            {conf.module}
                          </span>
                          <span className="font-mono">{conf.contract_no}</span>
                          <span className="text-xs text-muted">— {conf.status}</span>
                          {conf.bank && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${conf.same_bank ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                              {conf.bank}{conf.same_bank ? ' (same bank)' : ' (different bank)'}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className={`text-[11px] italic mt-2 ${hasBlocker ? 'text-red-700' : 'text-amber-700'}`}>
                {hasBlocker
                  ? '🚫 รถนี้ผูกอยู่กับสัญญา Active ของแบงก์เดียวกัน — เลือกไม่ได้'
                  : `⚠️ รถนี้ใช้ใน Active contract ของแบงก์อื่น (${warnConfs.length}) — เลือกต่อได้ แต่ระบบจะเตือน`}
              </p>
            </div>
            <div className="px-4 py-3 bg-soft border-t border-line flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConflictDialog(null)}>
                ยกเลิก
              </Button>
              {!hasBlocker && (
                <Button variant="danger" size="sm" onClick={forceConfirm}>
                  Force ใช้ต่อ
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
