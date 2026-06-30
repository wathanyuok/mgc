// Segment Lookup Service — stub mode (Phase 1)
// Per MoM_Loan_Lease_Workshop §6 + §38-40 — Financial Segment สำหรับลงบัญชี GL
// Phase 1: query local tables (Migration 0049 + 0050)
// Phase 2: swap to NetSuite SuiteTalk: GET /restlet/segments?type=...
//
// Pattern เดียวกับ vendor-lookup.ts

import { supabase } from './supabase';

// ───────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────
export interface Subsidiary {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  netsuite_subsidiary_id: string | null;
  active: boolean;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  netsuite_department_id: string | null;
  active: boolean;
}

export interface SegmentLocation {
  id: string;
  code: string;
  name: string;
  subsidiary_id: string | null;
  netsuite_location_id: string | null;
  active: boolean;
}

export interface Klass {
  id: string;
  code: string;
  name: string;
  netsuite_class_id: string | null;
  active: boolean;
}

// ───────────────────────────────────────────────────────────────────
// Lookup functions — Phase 1 reads from local tables
// ───────────────────────────────────────────────────────────────────

export interface LookupParams {
  query?: string;
  includeInactive?: boolean;
  limit?: number;
}

/** Subsidiary Lookup — สำหรับเลือกบริษัทย่อย (GL Segment col 7) */
export async function subsidiaryLookup({
  query = '',
  includeInactive = false,
  limit = 50,
}: LookupParams = {}): Promise<Subsidiary[]> {
  let q = supabase.from('subsidiaries').select('*').order('code').limit(limit);
  if (!includeInactive) q = q.eq('active', true);
  if (query.trim()) {
    const like = `%${query.trim()}%`;
    q = q.or(`code.ilike.${like},name.ilike.${like},tax_id.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) { console.warn('[subsidiaryLookup] error:', error); return []; }
  return (data ?? []) as Subsidiary[];
}

/** Department Lookup — แผนก (GL Segment) */
export async function departmentLookup({
  query = '',
  includeInactive = false,
  limit = 50,
}: LookupParams = {}): Promise<Department[]> {
  let q = supabase.from('departments').select('*').order('code').limit(limit);
  if (!includeInactive) q = q.eq('active', true);
  if (query.trim()) {
    const like = `%${query.trim()}%`;
    q = q.or(`code.ilike.${like},name.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) { console.warn('[departmentLookup] error:', error); return []; }
  return (data ?? []) as Department[];
}

/** Location Lookup — สาขา (GL Segment col 12/20) */
export async function locationLookup({
  query = '',
  includeInactive = false,
  limit = 50,
}: LookupParams = {}): Promise<SegmentLocation[]> {
  let q = supabase.from('locations').select('*').order('code').limit(limit);
  if (!includeInactive) q = q.eq('active', true);
  if (query.trim()) {
    const like = `%${query.trim()}%`;
    q = q.or(`code.ilike.${like},name.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) { console.warn('[locationLookup] error:', error); return []; }
  return (data ?? []) as SegmentLocation[];
}

/** Class Lookup — Business Class · เทียบ Business Type (GL Template col 17) */
export async function classLookup({
  query = '',
  includeInactive = false,
  limit = 50,
}: LookupParams = {}): Promise<Klass[]> {
  let q = supabase.from('classes').select('*').order('code').limit(limit);
  if (!includeInactive) q = q.eq('active', true);
  if (query.trim()) {
    const like = `%${query.trim()}%`;
    q = q.or(`code.ilike.${like},name.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) { console.warn('[classLookup] error:', error); return []; }
  return (data ?? []) as Klass[];
}

// ───────────────────────────────────────────────────────────────────
// Auto-derive RPT (Related Parties) — based on vendor_type
// Per MoM §6 + meeting transcript — Loan ในกลุ่ม vs นอกกลุ่ม
// ───────────────────────────────────────────────────────────────────
export type RPTType = 'External' | 'In-group' | 'Other';

/** Derive Related Parties from vendor record */
export function deriveRPT(vendorType: string | null | undefined): RPTType {
  if (!vendorType) return 'Other';
  // Intra-group: lessor companies = sister companies in MGC group
  if (vendorType === 'lessor') return 'In-group';
  // External: banks + suppliers + dealers + importers = third-party
  if (['bank', 'supplier', 'dealer', 'importer', 'customer'].includes(vendorType)) {
    return 'External';
  }
  return 'Other';
}
