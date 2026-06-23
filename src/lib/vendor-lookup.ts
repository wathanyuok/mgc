// Vendor Lookup Service — stub mode (Phase 1)
// Per MoM Interface §3 + §5 — MGC ขอเรียก vendor data จาก NetSuite Vendor Master
// Phase 1: stub from local `vendors` table (Migration 0046)
// Phase 2: swap to NetSuite SuiteTalk: GET /restlet/vendors?q=...&type=...

import { supabase } from './supabase';
import type { Vendor, VendorType } from '@/types/database';

export interface VendorLookupParams {
  query?: string;
  /** Filter by vendor_type — e.g., 'lessor' for IFRS 16 Lease, 'bank' for borrowings */
  type?: VendorType | VendorType[];
  /** Show inactive vendors too (default: false) */
  includeInactive?: boolean;
  limit?: number;
}

/**
 * Search vendors — stub mode pulls from local `vendors` table.
 * When NetSuite lookup endpoint is available, swap this body with:
 *   const res = await fetch(`${NETSUITE_BASE}/restlet/vendors?q=${query}&type=${type}`, { headers: { Authorization: ... }});
 *   return res.json();
 */
export async function vendorLookup({
  query = '',
  type,
  includeInactive = false,
  limit = 50,
}: VendorLookupParams = {}): Promise<Vendor[]> {
  let q = supabase.from('vendors').select('*').order('code').limit(limit);

  if (!includeInactive) q = q.eq('active', true);

  if (type) {
    const types = Array.isArray(type) ? type : [type];
    q = q.in('vendor_type', types);
  }

  if (query.trim()) {
    const like = `%${query.trim()}%`;
    // Search across code / name / tax_id / netsuite_vendor_id
    q = q.or(
      `code.ilike.${like},name.ilike.${like},tax_id.ilike.${like},netsuite_vendor_id.ilike.${like}`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[vendorLookup] error:', error);
    return [];
  }
  return (data ?? []) as Vendor[];
}
