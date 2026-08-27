// Facility Types — loaded from the `facility_types` master table
// (created in migration 0072). Replaces the hardcoded CA_FACILITY_TYPES
// array that used to live in src/types/database.ts.
//
// Usage:
//   const { facilityTypes } = useFacilityTypes();
//   facilityTypes.map(ft => <option value={ft.id}>{ft.name_en}</option>)
//
// The list is cached in memory for the session — refreshed by re-mounting
// the hook (or via manual query if admin editing).

import { useEffect, useState, useMemo } from 'react';
import { supabase } from './supabase';
import type { FacilityTypeMaster } from '@/types/database';

let cache: FacilityTypeMaster[] | null = null;
let inflightFetch: Promise<FacilityTypeMaster[]> | null = null;

async function fetchFacilityTypes(): Promise<FacilityTypeMaster[]> {
  if (cache) return cache;
  if (inflightFetch) return inflightFetch;
  inflightFetch = (async () => {
    const { data, error } = await supabase
      .from('facility_types')
      .select('id, code, name_en, name_th, sort_order, active')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('[facility-types] load failed:', error.message);
      inflightFetch = null;
      return [];
    }
    cache = data as FacilityTypeMaster[];
    inflightFetch = null;
    return cache;
  })();
  return inflightFetch;
}

/** Prewarm the cache at app boot. Call once from main.tsx or a top-level effect. */
export async function preloadFacilityTypes(): Promise<void> {
  await fetchFacilityTypes();
}

/** Clear the module-level cache (call after admin edits list). */
export function invalidateFacilityTypesCache(): void {
  cache = null;
}

/**
 * Normalize legacy string codes to the canonical `facility_types.code` value.
 * Handles all historical variants: 'P/N' → 'PN', 'BG' → 'LG', 'Loan' → 'LOAN',
 * 'floor_plan' → 'FP', 'Hire Purchase' → 'HP', etc.
 */
export function normalizeFacilityCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const map: Record<string, string> = {
    'P/N': 'PN',
    'PN': 'PN',
    'BG': 'LG',
    'LG': 'LG',
    'Loan': 'LOAN',
    'loan': 'LOAN',
    'LOAN': 'LOAN',
    'Lease': 'LEASE',
    'lease': 'LEASE',
    'LEASE': 'LEASE',
    'floor_plan': 'FP',
    'FP': 'FP',
    'HP': 'HP',
    'Hire Purchase': 'HP',
    'O/D': 'OD',
    'OD': 'OD',
    'T/R': 'TR',
    'TR': 'TR',
    'Floor Plan': 'FP',
    'LG/BG': 'LG',
    'FX Forward': 'FXF',
    'FXF': 'FXF',
    'LC': 'LC',
    'LC (Letter of Credit)': 'LC',
    'SBLC': 'SBLC',
    'SBLC (Standby LC)': 'SBLC',
  };
  return map[raw] ?? raw;
}

/**
 * รหัสมาตรฐานในฐานข้อมูล → รหัสที่ใช้แสดงบนหน้าจอ
 *
 * ตัวเลือกในหน้าจอบางที่เขียนเป็น 'P/N' / 'Loan' / 'Lease' ขณะที่ทะเบียนเก็บเป็น
 * 'PN' / 'LOAN' / 'LEASE' · ถ้าเอาค่าจากทะเบียนไปใส่ตรงๆ ช่องเลือกจะว่างทั้งที่มีข้อมูล
 * ฟังก์ชันนี้แปลงกลับให้ตรงกับตัวเลือกบนหน้าจอ
 */
export function toUiFacilityCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const map: Record<string, string> = {
    PN: 'P/N',
    LOAN: 'Loan',
    LEASE: 'Lease',
  };
  return map[raw] ?? raw;
}

/** Async: code → UUID (uses module cache). */
export async function facilityTypeIdByCode(code: string | null | undefined): Promise<string | null> {
  const norm = normalizeFacilityCode(code);
  if (!norm) return null;
  const list = await fetchFacilityTypes();
  return list.find((ft) => ft.code === norm)?.id ?? null;
}

/** Async: UUID → code (uses module cache). */
export async function facilityTypeCodeById(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const list = await fetchFacilityTypes();
  return list.find((ft) => ft.id === id)?.code ?? null;
}

/** Sync: code → UUID from an already-loaded list (use with useFacilityTypes). */
export function findFacilityTypeIdByCode(list: FacilityTypeMaster[], code: string | null | undefined): string | null {
  const norm = normalizeFacilityCode(code);
  if (!norm) return null;
  return list.find((ft) => ft.code === norm)?.id ?? null;
}

/** Sync: UUID → code from an already-loaded list. */
export function findFacilityTypeCodeById(list: FacilityTypeMaster[], id: string | null | undefined): string | null {
  if (!id) return null;
  return list.find((ft) => ft.id === id)?.code ?? null;
}

export function useFacilityTypes(): {
  facilityTypes: FacilityTypeMaster[];
  loading: boolean;
} {
  const [facilityTypes, setFacilityTypes] = useState<FacilityTypeMaster[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let cancelled = false;
    fetchFacilityTypes().then((list) => {
      if (!cancelled) {
        setFacilityTypes(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { facilityTypes, loading };
}

/** Hook: returns bidirectional maps for sync lookups inside React components. */
export function useFacilityTypesMap(): {
  facilityTypes: FacilityTypeMaster[];
  loading: boolean;
  codeToId: (code: string | null | undefined) => string | null;
  idToCode: (id: string | null | undefined) => string | null;
} {
  const { facilityTypes, loading } = useFacilityTypes();
  const { codeMap, idMap } = useMemo(() => {
    const codeMap = new Map<string, string>();
    const idMap = new Map<string, string>();
    facilityTypes.forEach((ft) => {
      codeMap.set(ft.code, ft.id);
      idMap.set(ft.id, ft.code);
    });
    return { codeMap, idMap };
  }, [facilityTypes]);

  const codeToId = (code: string | null | undefined): string | null => {
    const norm = normalizeFacilityCode(code);
    if (!norm) return null;
    return codeMap.get(norm) ?? null;
  };
  const idToCode = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return idMap.get(id) ?? null;
  };

  return { facilityTypes, loading, codeToId, idToCode };
}

/** Look up a facility type by ID. Returns null if not found or not loaded yet. */
export function findFacilityTypeById(
  list: FacilityTypeMaster[],
  id: string | null | undefined,
): FacilityTypeMaster | null {
  if (!id) return null;
  return list.find((ft) => ft.id === id) ?? null;
}
