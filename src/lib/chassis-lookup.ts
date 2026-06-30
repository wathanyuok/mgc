// Chassis Lookup Service — Mock NetSuite Inventory (Aliyan)
// Per MoM_MGC_LoanLease_NetSuite §5 — รถซื้อมาขาย เก็บใน Inventory
//
// Used by:
//   1. LeaseDetail (HP mode) — เช่าซื้อรถ ลูกค้า
//   2. FPDetail — Floor Plan
//   3. LoanDetail — Loan with collateral
//   4. PNDetail — Promissory Note with chassis
//
// Replace mock with real NetSuite SuiteTalk REST API when Spec available.
//
// Conflict Check (per BR-LEASE-026 / BR-LOAN-014 / BR-FP-017 / BR-PN-013):
// 1 Chassis = 1 รถ ขายซ้ำใน 2 Active contract ไม่ได้.

import { supabase } from './supabase';

export interface ChassisInventory {
  id: string;
  chassis_no: string;
  engine_no: string;
  car_model: string;
  location: string;
  cost: number;
}

// ─── Mock Data ──────────────────────────────────────────────────────
const MOCK_INVENTORY: ChassisInventory[] = [
  { id: 'inv-1', chassis_no: 'MMTFR86A8RH001238', engine_no: 'B38A15-1107238', car_model: 'MINI Cooper S 5DR', location: 'MAG Phaholyothin', cost: 2_390_000 },
  { id: 'inv-2', chassis_no: 'WBA8E5C50JG924765', engine_no: 'B48B20-8847213', car_model: 'BMW 320i M Sport', location: 'MAG Rama 9', cost: 1_800_000 },
  { id: 'inv-3', chassis_no: 'WMW7D5108K5K12345', engine_no: 'B38A15-3320145', car_model: 'MINI Cooper Country', location: 'MAG Bangna', cost: 1_650_000 },
  { id: 'inv-4', chassis_no: 'WBAJB4C50KBV98762', engine_no: 'B48B20-9912034', car_model: 'BMW 530e M Sport', location: 'MAG HQ Showroom', cost: 3_450_000 },
  { id: 'inv-5', chassis_no: 'WAUE8AF44LA011234', engine_no: 'DLVA-4451209', car_model: 'Audi A6 45 TFSI', location: 'MAG Lat Phrao', cost: 3_290_000 },
  { id: 'inv-6', chassis_no: 'JHMFC1F70KX021234', engine_no: 'L15B7-2203471', car_model: 'Honda Civic RS', location: 'MAG Rangsit', cost: 1_090_000 },
  { id: 'inv-7', chassis_no: 'MMF24FW020Y000001', engine_no: 'B58B30-1207854', car_model: 'BMW X7 xDrive40d', location: 'MAG Latphrao', cost: 5_990_000 },
  { id: 'inv-8', chassis_no: 'MMF24FW020Y000002', engine_no: 'B58B30-1208001', car_model: 'BMW X7 xDrive40d', location: 'MAG Latphrao', cost: 5_990_000 },
  { id: 'inv-9', chassis_no: 'MMF24FW020Y000003', engine_no: 'B58B30-1208123', car_model: 'BMW X5 xDrive40i', location: 'MAG Latphrao', cost: 4_290_000 },
];

// ─── Lookup Function ────────────────────────────────────────────────
export interface ChassisLookupParams {
  query?: string;          // search by chassis_no / model / location
  excludeIds?: Set<string>;
  limit?: number;          // pagination cap · default 50 (NetSuite returns thousands)
  offset?: number;         // pagination offset · default 0 — reserved for future "load more"
}

export interface ChassisLookupResult {
  rows: ChassisInventory[];
  total: number;           // total matching (before limit) — drives "hit limit" hint
  hasMore: boolean;        // true if total > offset+rows.length
}

export async function chassisLookup(params: ChassisLookupParams = {}): Promise<ChassisLookupResult> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  console.log('🔵 [Chassis Stub] Lookup with params:', params, '| limit:', limit, 'offset:', offset);
  await new Promise((r) => setTimeout(r, 200));

  let results = MOCK_INVENTORY;
  if (params.excludeIds && params.excludeIds.size > 0) {
    results = results.filter((c) => !params.excludeIds!.has(c.id));
  }
  if (params.query) {
    const q = params.query.toLowerCase().trim();
    if (q) {
      results = results.filter(
        (c) =>
          c.chassis_no.toLowerCase().includes(q) ||
          c.car_model.toLowerCase().includes(q) ||
          c.location.toLowerCase().includes(q),
      );
    }
  }
  const total = results.length;
  const page = results.slice(offset, offset + limit);
  const hasMore = total > offset + page.length;
  console.log(`✅ [Chassis Stub] Returned ${page.length} of ${total} (hasMore=${hasMore})`);
  return { rows: page, total, hasMore };
}

// ─── Conflict Check ─────────────────────────────────────────────────
// Per MoM_Loan_Lease_Workshop §12.1 + Workshop transcript (Option B):
//   Same bank → 🚫 BLOCK (ทุกประเภทสินเชื่อ FP/PN/Loan/HP)
//   Different bank → ⚠ WARN (เตือนเฉยๆ ไม่บล็อก)
//
// Caller (Save handler) ดู conflict.same_bank แล้วตัดสินใจ block vs warn

export type ConflictModule = 'HP' | 'Loan' | 'FP' | 'PN';

export interface ChassisConflict {
  module: ConflictModule;
  contract_no: string;
  status: string;
  bank: string;        // existing contract's finance institution
  same_bank: boolean;  // matches caller's currentBank → true means BLOCK, false means WARN
}

// Per-module active statuses (each module's enum) — actual DB enum values:
//   lease_status: Draft, Active, Closed, Modified, Approved, Roll Over
//   loan_status:  Draft, Active, Closed, Modified, Approved, Rejected, Cancelled
//   fp_status:    Draft, Active, Closed, Cancelled, Approved, Roll Over
//   pn_status:    Draft, Approved, Roll Over, Repaid, Cancelled  ← NO 'Active'!
const LEASE_ACTIVE = ['Draft', 'Approved', 'Active', 'Modified', 'Roll Over'];
const LOAN_ACTIVE = ['Draft', 'Approved', 'Active', 'Modified'];
const FP_ACTIVE = ['Draft', 'Approved', 'Active', 'Roll Over'];
const PN_ACTIVE = ['Draft', 'Approved', 'Roll Over'];

export async function checkChassisConflict(
  chassisNo: string,
  excludeModule?: ConflictModule,
  excludeContractId?: string,
  currentBank?: string | null,  // ← caller's finance_institution (case-insensitive compare)
): Promise<ChassisConflict[]> {
  if (!chassisNo) return [];
  const conflicts: ChassisConflict[] = [];
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const curBank = norm(currentBank);

  // 1) HP — leases.chassis_no · finance_institution via CA → MA chain
  if (excludeModule !== 'HP') {
    const { data, error } = await supabase
      .from('leases')
      .select('id, lease_no, chassis_no, status, ca_id, credit_agreements(finance_institution)')
      .eq('mode', 'hp')
      .eq('chassis_no', chassisNo)
      .in('status', LEASE_ACTIVE);
    if (error) console.warn('[Chassis Conflict — HP] error:', error);
    (data ?? []).forEach((r: any) => {
      if (excludeContractId && r.id === excludeContractId) return;
      const bank = (r.credit_agreements?.finance_institution as string | undefined) ?? '';
      conflicts.push({
        module: 'HP', contract_no: r.lease_no, status: r.status,
        bank, same_bank: !!curBank && norm(bank) === curBank,
      });
    });
  }

  // 2) Loan chassis — sub-table → loans.finance_institution
  if (excludeModule !== 'Loan') {
    const { data, error } = await supabase
      .from('loan_chassis')
      .select('chassis_no, loan_id')
      .eq('chassis_no', chassisNo);
    if (error) {
      console.warn('[Chassis Conflict — Loan] table missing or RLS:', error.message);
    } else if (data && data.length > 0) {
      const loanIds = data.map((r: any) => r.loan_id).filter(Boolean);
      if (loanIds.length > 0) {
        const { data: loans } = await supabase
          .from('loans')
          .select('id, loan_no, status, finance_institution')
          .in('id', loanIds)
          .in('status', LOAN_ACTIVE);
        (loans ?? []).forEach((loan: any) => {
          if (excludeContractId && loan.id === excludeContractId) return;
          const bank = (loan.finance_institution as string | undefined) ?? '';
          conflicts.push({
            module: 'Loan', contract_no: loan.loan_no, status: loan.status,
            bank, same_bank: !!curBank && norm(bank) === curBank,
          });
        });
      }
    }
  }

  // 3) FP chassis — sub-table → floor_plans.finance_institution
  if (excludeModule !== 'FP') {
    const { data, error } = await supabase
      .from('fp_chassis')
      .select('chassis_no, fp_id')
      .eq('chassis_no', chassisNo);
    if (error) {
      console.warn('[Chassis Conflict — FP] table missing or RLS:', error.message);
    } else if (data && data.length > 0) {
      const fpIds = data.map((r: any) => r.fp_id).filter(Boolean);
      if (fpIds.length > 0) {
        const { data: fps } = await supabase
          .from('floor_plans')
          .select('id, fp_no, status, finance_institution')
          .in('id', fpIds)
          .in('status', FP_ACTIVE);
        (fps ?? []).forEach((fp: any) => {
          if (excludeContractId && fp.id === excludeContractId) return;
          const bank = (fp.finance_institution as string | undefined) ?? '';
          conflicts.push({
            module: 'FP', contract_no: fp.fp_no, status: fp.status,
            bank, same_bank: !!curBank && norm(bank) === curBank,
          });
        });
      }
    }
  }

  // 4) PN chassis — JSONB chassis_list in promissory_notes
  if (excludeModule !== 'PN') {
    const { data, error } = await supabase
      .from('promissory_notes')
      .select('id, name, status, chassis_list, finance_institution')
      .in('status', PN_ACTIVE);
    if (error) console.warn('[Chassis Conflict — PN]', error);
    (data ?? []).forEach((pn: any) => {
      if (excludeContractId && pn.id === excludeContractId) return;
      const list = Array.isArray(pn.chassis_list) ? pn.chassis_list : [];
      const found = list.some((c: any) => c && c.chassis_no === chassisNo);
      if (found) {
        const bank = (pn.finance_institution as string | undefined) ?? '';
        conflicts.push({
          module: 'PN', contract_no: pn.name, status: pn.status,
          bank, same_bank: !!curBank && norm(bank) === curBank,
        });
      }
    });
  }

  const blocking = conflicts.filter((c) => c.same_bank).length;
  console.log(`🔍 [Chassis Conflict] ${chassisNo} (curBank=${currentBank ?? 'N/A'}) → ${conflicts.length} active · ${blocking} blocking same-bank`);
  return conflicts;
}

// ─── Helper: classify conflict result ───────────────────────────────
// Used by Save handlers to decide BLOCK vs WARN per MoM Option B
export function classifyConflicts(conflicts: ChassisConflict[]): {
  blockers: ChassisConflict[];   // same bank → must block save
  warnings: ChassisConflict[];   // different bank → warn but allow
} {
  return {
    blockers: conflicts.filter((c) => c.same_bank),
    warnings: conflicts.filter((c) => !c.same_bank),
  };
}
