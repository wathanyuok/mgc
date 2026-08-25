import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ListFilter {
  search: string;
  caFilter: string;
  typeFilter: string;
  statusFilter: string;
  subsidiary: string;
  bank: string;
}

const blank: ListFilter = {
  search: '',
  caFilter: '',
  typeFilter: '',
  statusFilter: '',
  subsidiary: '',
  bank: '',
};

type ModuleKey = 'ma' | 'ca' | 'pn' | 'lg' | 'fp' | 'od' | 'tr' | 'fxf' | 'lc' | 'loan' | 'repayment' | 'leaseHp' | 'leaseLeasing' | 'leaseOther';

interface FiltersState {
  filters: Record<ModuleKey, ListFilter>;
  set: (mod: ModuleKey, patch: Partial<ListFilter>) => void;
  clear: (mod: ModuleKey) => void;
}

const makeBlank = (): Record<ModuleKey, ListFilter> => ({
  ma: { ...blank }, ca: { ...blank },
  pn: { ...blank }, lg: { ...blank }, fp: { ...blank }, od: { ...blank },
  tr: { ...blank }, fxf: { ...blank }, lc: { ...blank }, loan: { ...blank },
  repayment: { ...blank }, leaseHp: { ...blank }, leaseLeasing: { ...blank }, leaseOther: { ...blank },
});

export const useFiltersStore = create<FiltersState>()(
  persist(
    (set, get) => ({
      filters: makeBlank(),
      set: (mod, patch) => set({ filters: { ...get().filters, [mod]: { ...(get().filters[mod] ?? blank), ...patch } } }),
      clear: (mod) => set({ filters: { ...get().filters, [mod]: { ...blank } } }),
    }),
    {
      name: 'mgc-filters',
      // ค่าที่เคยเก็บไว้ในเครื่องผู้ใช้จะไม่มีโมดูลที่เพิ่มทีหลัง
      // ถ้าไม่เติมค่าเริ่มต้นให้ หน้าจอของโมดูลใหม่จะพังทันทีตอนอ่านค่าตัวกรอง
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as object),
        filters: { ...makeBlank(), ...((persisted as any)?.filters ?? {}) },
      }),
    },
  ),
);

export function useModuleFilter(mod: ModuleKey) {
  // fallback เป็น object เดิมเสมอ (ไม่สร้างใหม่ทุกรอบ) กัน re-render ไม่รู้จบ
  const filter = useFiltersStore((s) => s.filters[mod] ?? blank);
  const set = useFiltersStore((s) => s.set);
  const clear = useFiltersStore((s) => s.clear);
  return { filter, patch: (p: Partial<ListFilter>) => set(mod, p), clear: () => clear(mod) };
}
