import { useState, useEffect } from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, SearchableSelect } from '@/components/ui';
import { chassisLookup, checkChassisConflict, classifyConflicts, type ChassisInventory, type ConflictModule, type ChassisConflict } from '@/lib/chassis-lookup';
import { isCommittedHolder } from '@/lib/chassis-overlap';
import { fmtMoney } from '@/lib/format';

// เลขหน้าแบบมีหน้าต่าง (window) + จุดไข่ปลา — เช่น 1 … 4 5 [6] 7 8 … 20
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…');
  for (let p = from; p <= to; p++) out.push(p);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

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
  const [filterModel, setFilterModel] = useState<string>('');     // MoM บ.1201: filter by รุ่นรถ (เต็ม) แยกจาก brand
  const [filterSubModel, setFilterSubModel] = useState<string>(''); // filter by รุ่นย่อย (sub model / trim)
  const [filterLocation, setFilterLocation] = useState<string>(''); // A4: filter by location
  const [page, setPage] = useState(1);                            // หน้าปัจจุบัน (แบ่งหน้าฝั่ง client)
  const ROWS_PER_PAGE = 15;
  // PO No / PO Date — ไม่กรองที่ Lookup Inventory (NetSuite Inventory ไม่เก็บเลข PO) · ดึงตาม PO ทำที่ PO Ref Import
  const [results, setResults] = useState<ChassisInventory[]>([]);
  const [allResults, setAllResults] = useState<ChassisInventory[]>([]);  // unfiltered (for dropdown options)
  const [hasMore, setHasMore] = useState(false);  // server returned partial · user must refine search
  const [totalCount, setTotalCount] = useState(0); // total matching (before limit)
  const [loading, setLoading] = useState(false);
  // เก็บเป็น Map (id → chassis object) ไม่ใช่แค่ id — selection ต้องคงอยู่ข้าม search/filter
  // แม้แถวนั้นจะถูก server กรองออกชั่วคราว (MoM 30 ก.ย. บ.1125: "ติ๊กแล้วต้องยังอยู่ · โชว์ว่าติ๊กอะไรไว้")
  const [selected, setSelected] = useState<Map<string, ChassisInventory>>(new Map());

  const PAGE_LIMIT = 50;

  // ─── A4 (MoM Open #9): Filter dimensions extracted from data ─────────
  const brandFromModel = (model: string): string => {
    const m = model.split(/\s+/);
    return m[0] || '';  // "BMW 320i M Sport" → "BMW"
  };
  const availableBrands = Array.from(new Set(allResults.map((c) => brandFromModel(c.car_model)).filter(Boolean))).sort();
  // รุ่นรถ — ถ้าเลือกยี่ห้อแล้ว โชว์เฉพาะรุ่นของยี่ห้อนั้น
  const availableModels = Array.from(new Set(
    allResults.filter((c) => !filterBrand || brandFromModel(c.car_model) === filterBrand).map((c) => c.car_model).filter(Boolean),
  )).sort();
  // รุ่นย่อย — ถ้าเลือกยี่ห้อ/รุ่นแล้ว โชว์เฉพาะ sub model ที่อยู่ในขอบเขตนั้น
  const availableSubModels = Array.from(new Set(
    allResults
      .filter((c) => (!filterBrand || brandFromModel(c.car_model) === filterBrand) && (!filterModel || c.car_model === filterModel))
      .map((c) => c.sub_model).filter(Boolean),
  )).sort();
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
    // ใช้ของที่เลือกไว้ทั้งหมด (รวมคันที่ถูกกรองออกจากตารางชั่วคราว) ไม่ใช่แค่ที่เห็นอยู่
    const picked = Array.from(selected.values());
    if (picked.length === 0) return;
    const conflictMap = new Map<string, ChassisConflict[]>();
    for (const c of picked) {
      const conflicts = await checkChassisConflict(c.chassis_no, excludeModule, excludeContractId, currentBank);
      if (conflicts.length > 0) conflictMap.set(c.id, conflicts);
    }
    if (conflictMap.size === 0) {
      (props as MultiProps).onSelect(picked);
      onClose();
      return;
    }
    // เพิ่มคันที่ไม่มีปัญหาเข้าไปก่อน แล้วค่อยถามเฉพาะคันที่ติด
    //
    // เดิมถ้ามีคันเดียวที่ชนกับสัญญาอื่น ระบบบล็อกทั้งชุด เหลือแต่ปุ่มยกเลิก
    // และเอาคันที่ติดออกทีละคันในหน้าต่างนั้นไม่ได้ ต้องเริ่มเลือกใหม่ทั้งหมด
    const clean = picked.filter((c) => !conflictMap.has(c.id));
    const conflicted = picked.filter((c) => conflictMap.has(c.id));
    if (clean.length > 0) {
      (props as MultiProps).onSelect(clean);
      setSelected(new Map(conflicted.map((c) => [c.id, c])));
    }
    setConflictDialog({ items: conflicted, conflictMap });
  };

  const toggleRow = (c: ChassisInventory) =>
    setSelected((s) => {
      const n = new Map(s);
      if (n.has(c.id)) n.delete(c.id);
      else n.set(c.id, c);
      return n;
    });

  // เลือก/เอาออก "ทั้งหมดในหน้านี้" — ไม่ไปแตะคันที่เลือกไว้แต่ถูกกรอง/อยู่หน้าอื่น
  const toggleAll = () => {
    const pageAllSelected = paged.length > 0 && paged.every((c) => selected.has(c.id));
    setSelected((s) => {
      const n = new Map(s);
      if (pageAllSelected) paged.forEach((c) => n.delete(c.id));
      else paged.forEach((c) => n.set(c.id, c));
      return n;
    });
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
      setFilterModel('');
      setFilterSubModel('');
      setFilterLocation('');
      setPage(1);
      setSelected(new Map());
      run('');
    }
  }, [open]);

  // Re-apply client-side filters when any filter changes
  // NOTE: ไม่ล้าง selection ที่ถูกกรองออก — selection ต้องคงอยู่ข้าม search/filter (MoM บ.1125)
  useEffect(() => {
    let r = allResults;
    if (filterBrand) r = r.filter((c) => brandFromModel(c.car_model) === filterBrand);
    if (filterModel) r = r.filter((c) => c.car_model === filterModel);
    if (filterSubModel) r = r.filter((c) => c.sub_model === filterSubModel);
    if (filterLocation) r = r.filter((c) => c.location === filterLocation);
    if (excludeChassisNos && excludeChassisNos.length > 0) {
      r = r.filter((c) => !excludeChassisNos.includes(c.chassis_no));
    }
    setResults(r);
    setPage(1);  // กรอง/ค้นใหม่ → กลับหน้า 1
  }, [allResults, filterBrand, filterModel, filterSubModel, filterLocation]);

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

  // ─── แบ่งหน้า (client-side) เหนือผลลัพธ์ที่กรองแล้ว ───
  const pageCount = Math.max(1, Math.ceil(results.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const paged = results.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  // header checkbox อิงกับ "ที่แสดงอยู่ในหน้านี้" เท่านั้น
  const visibleSelectedCount = paged.filter((c) => selected.has(c.id)).length;
  const allSelected = paged.length > 0 && visibleSelectedCount === paged.length;
  const someSelected = visibleSelectedCount > 0 && visibleSelectedCount < paged.length;
  // จำนวนที่เลือกไว้แต่ไม่อยู่ในหน้านี้ (กรองออก/อยู่หน้าอื่น · ยังนับรวมตอน Add)
  const hiddenSelectedCount = selected.size - visibleSelectedCount;

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
              placeholder="ค้นหา Chassis No / Model / Sub Model / Invoice / Location"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                run(e.target.value);
              }}
              autoFocus
            />
          </div>
          {/* Filter Criteria (MoM บ.1201) — ยี่ห้อ · รุ่นรถ · สาขา · (เพิ่มใหม่ · รอ Reconfirm → label สีแดง) */}
          <div className="flex gap-2 items-center text-xs flex-wrap">
            <label className="text-red-600 font-medium">กรอง (Search Criteria):</label>
            <SearchableSelect
              className="min-w-[130px]"
              value={filterBrand}
              onChange={(e) => { setFilterBrand(e.target.value); setFilterModel(''); setFilterSubModel(''); }}
            >
              <option value="">Brand: ทั้งหมด</option>
              {availableBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </SearchableSelect>
            <SearchableSelect
              className="min-w-[160px]"
              value={filterModel}
              onChange={(e) => { setFilterModel(e.target.value); setFilterSubModel(''); }}
            >
              <option value="">Model: ทั้งหมด</option>
              {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </SearchableSelect>
            <SearchableSelect
              className="min-w-[150px]"
              value={filterSubModel}
              onChange={(e) => setFilterSubModel(e.target.value)}
            >
              <option value="">Sub Model: ทั้งหมด</option>
              {availableSubModels.map((s) => <option key={s} value={s}>{s}</option>)}
            </SearchableSelect>
            <SearchableSelect
              className="min-w-[150px]"
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
            >
              <option value="">Location: ทั้งหมด</option>
              {availableLocations.map((l) => <option key={l} value={l}>{l}</option>)}
            </SearchableSelect>
            {(filterBrand || filterModel || filterSubModel || filterLocation) && (
              <button
                onClick={() => { setFilterBrand(''); setFilterModel(''); setFilterSubModel(''); setFilterLocation(''); }}
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
          {/* MoM บ.1125: โชว์ว่าติ๊กอะไรไว้แล้วบ้าง — คงอยู่ข้าม search/filter */}
          {multi && selected.size > 0 && (
            <div className="flex items-center gap-2 text-[11px] bg-brand-light/30 border border-brand-light rounded px-2 py-1">
              <span className="font-medium text-brand-700">เลือกไว้ {selected.size} คัน</span>
              {hiddenSelectedCount > 0 && (
                <span className="text-amber-700">({hiddenSelectedCount} คันถูกกรองซ่อนอยู่ · ยังนับรวมตอนเพิ่ม)</span>
              )}
              <button onClick={() => setSelected(new Map())} className="ml-auto text-muted hover:underline">
                ล้างที่เลือก
              </button>
            </div>
          )}
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
                  <th>Invoice</th>
                  <th>Engine No</th>
                  <th>Model</th>
                  <th>Sub Model</th>
                  <th>Location</th>
                  <th className="text-right">Cost</th>
                  {!multi && <th />}
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-soft ${checked ? 'bg-brand-light/30' : ''} ${multi ? 'cursor-pointer' : ''}`}
                      onClick={multi ? () => toggleRow(c) : undefined}
                    >
                      {multi && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRow(c)}
                            className="cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="font-mono text-xs">{c.chassis_no}</td>
                      <td className="font-mono text-xs text-red-600">{c.invoice || '—'}</td>
                      <td className="font-mono text-xs">{c.engine_no}</td>
                      <td className="text-xs">{c.car_model}</td>
                      <td className="text-xs text-muted">{c.sub_model || '—'}</td>
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

          {/* แบ่งหน้า — เลขหน้า + ก่อนหน้า/ถัดไป (client-side เหนือผลลัพธ์ที่กรองแล้ว) */}
          {!loading && results.length > 0 && (
            <div className="flex items-center justify-center flex-wrap gap-1 p-2 border-t border-line bg-soft/40 text-xs select-none">
              <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}
                className="px-2 py-1 rounded border border-line disabled:opacity-40 hover:bg-white">‹</button>
              {pageNumbers(safePage, pageCount).map((p, i) =>
                p === '…'
                  ? <span key={`e${i}`} className="px-1 text-muted">…</span>
                  : <button key={p} type="button" onClick={() => setPage(p as number)}
                      className={`px-2.5 py-1 rounded border ${p === safePage ? 'bg-brand text-white border-brand font-semibold' : 'border-line hover:bg-white'}`}>{p}</button>,
              )}
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}
                className="px-2 py-1 rounded border border-line disabled:opacity-40 hover:bg-white">›</button>
              <span className="ml-2 text-muted">หน้า {safePage} / {pageCount} · {results.length.toLocaleString()} คัน</span>
            </div>
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
              disabled={selected.size === 0}
            >
              Add Selected ({selected.size})
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
                      {confs.map((conf, i) => {
                        // แดง = บล็อกจริง (แบงก์เดียวกัน + สัญญามีผลแล้ว) · เหลือง = แค่เตือน (Draft/รออนุมัติ หรือต่างแบงก์)
                        const isBlock = conf.same_bank && isCommittedHolder(conf.status);
                        return (
                        <li key={i} className="flex items-center gap-2">
                          <span className={`inline-block w-12 text-center text-[10px] font-bold border rounded px-1.5 py-0.5 ${isBlock ? 'bg-red-100 border-red-300 text-red-800' : 'bg-soft border-line'}`}>
                            {conf.module}
                          </span>
                          <span className="font-mono">{conf.contract_no}</span>
                          <span className="text-xs text-muted">— {conf.status}</span>
                          {conf.bank && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isBlock ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                              {conf.bank}{conf.same_bank ? ' (แบงก์เดียวกัน)' : ' (ต่างแบงก์)'}
                            </span>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              <p className={`text-[11px] italic mt-2 ${hasBlocker ? 'text-red-700' : 'text-amber-700'}`}>
                {hasBlocker
                  ? `🚫 รถคันนี้ถูกใช้ในสัญญาที่ใช้งานอยู่ของแบงก์เดียวกัน (${blockers.map((b) => `${b.module} ${b.contract_no}`).join(', ')}) — เลือกไม่ได้`
                  : `⚠️ รถคันนี้ถูกใช้ในสัญญาอื่นอยู่ (${warnConfs.map((w) => `${w.module} ${w.contract_no} · ${w.status}`).join(', ')})`}
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
