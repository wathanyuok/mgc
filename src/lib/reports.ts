// Reports & Dashboard aggregations (MoM Day1 §6 + Day4 §12)
//   Operational: Portfolio summary, Credit Utilization, Loan Movement, Interest,
//   Collateral, Maturity-within-1yr · Lease: Lease Liability / ROU Asset movement.
// All figures derive live from the transaction tables + JE — system is the source.
import { supabase } from './supabase';

// Statuses that no longer count as open/outstanding (repaid/closed/rolled/cancelled/etc.)
const CLOSED = ['Repaid', 'Closed', 'Cancelled', 'Rejected', 'Roll Over', 'Voided', 'Settled', 'Expired', 'Terminated', 'Modified'];
export const isOpen = (status: string | null | undefined) => !CLOSED.includes(String(status ?? ''));

const DAY = 86400000;

export interface ProductDef {
  key: string;
  table: string;
  amountCol: string;
  dateCol: string;
  label: string;
  route: string;
  color: string;
}

// One row per product line. color = brand-aligned palette for charts.
export const PRODUCTS: ProductDef[] = [
  { key: 'loan', table: 'loans', amountCol: 'principal', dateCol: 'installment_end_date', label: 'Loan', route: '/tx/loan', color: '#2563eb' },
  { key: 'pn', table: 'promissory_notes', amountCol: 'amount', dateCol: 'maturity_date', label: 'P/N', route: '/tx/pn', color: '#0891b2' },
  { key: 'lg', table: 'letter_guarantees', amountCol: 'amount', dateCol: 'expiry_date', label: 'LG/BG', route: '/tx/lg', color: '#7c3aed' },
  { key: 'fp', table: 'floor_plans', amountCol: 'amount', dateCol: 'maturity_date', label: 'Floor Plan', route: '/tx/fp', color: '#db2777' },
  { key: 'od', table: 'overdrafts', amountCol: 'amount', dateCol: 'end_date', label: 'O/D', route: '/tx/od', color: '#ea580c' },
  { key: 'tr', table: 'trust_receipts', amountCol: 'amount', dateCol: 'due_date', label: 'T/R', route: '/tx/tr', color: '#16a34a' },
  { key: 'fxf', table: 'fx_forwards', amountCol: 'amount', dateCol: 'maturity_date', label: 'FX Forward', route: '/tx/fxf', color: '#ca8a04' },
  { key: 'lease', table: 'leases', amountCol: 'principal', dateCol: 'end_date', label: 'Lease/HP', route: '/lease/hp', color: '#0d9488' },
];

export interface ProductSummary {
  key: string;
  label: string;
  color: string;
  route: string;
  count: number;       // open contracts
  outstanding: number; // sum amount of open contracts
}

/** Portfolio: per-product open count + outstanding. */
export async function getPortfolioSummary(): Promise<ProductSummary[]> {
  const out: ProductSummary[] = [];
  for (const p of PRODUCTS) {
    const { data } = await supabase.from(p.table).select('*');
    let count = 0;
    let outstanding = 0;
    for (const r of (data ?? []) as any[]) {
      if (!isOpen(r.status)) continue;
      count++;
      outstanding += Number(r[p.amountCol] ?? 0);
    }
    out.push({ key: p.key, label: p.label, color: p.color, route: p.route, count, outstanding });
  }
  return out;
}

export interface CAUtilization {
  id: string;
  name: string;
  creditType: string;
  creditLine: number;
  used: number;
  available: number;
  pct: number;
}

/** Credit Utilization per CA: credit_line vs Σ outstanding (Utilized / Un-Utilized). */
export async function getCreditUtilization(): Promise<{ rows: CAUtilization[]; totalLine: number; totalUsed: number }> {
  const { data: cas } = await supabase.from('credit_agreements').select('id, ca_name, credit_type, credit_line');
  const drawTables: { table: string; col: string }[] = [
    { table: 'loans', col: 'principal' },
    { table: 'promissory_notes', col: 'amount' },
    { table: 'letter_guarantees', col: 'amount' },
    { table: 'floor_plans', col: 'amount' },
    { table: 'overdrafts', col: 'amount' },
    { table: 'trust_receipts', col: 'amount' },
  ];
  // used per ca_id
  const usedByCa = new Map<string, number>();
  for (const t of drawTables) {
    const { data } = await supabase.from(t.table).select(`ca_id, status, ${t.col}`);
    for (const r of (data ?? []) as any[]) {
      if (!r.ca_id || !isOpen(r.status)) continue;
      usedByCa.set(r.ca_id, (usedByCa.get(r.ca_id) ?? 0) + Number(r[t.col] ?? 0));
    }
  }
  const rows: CAUtilization[] = [];
  let totalLine = 0;
  let totalUsed = 0;
  for (const ca of (cas ?? []) as any[]) {
    const line = Number(ca.credit_line ?? 0);
    const used = usedByCa.get(ca.id) ?? 0;
    totalLine += line;
    totalUsed += used;
    rows.push({
      id: ca.id, name: ca.ca_name ?? ca.id, creditType: ca.credit_type ?? '',
      creditLine: line, used, available: line - used, pct: line > 0 ? (used / line) * 100 : 0,
    });
  }
  rows.sort((a, b) => b.pct - a.pct);
  return { rows, totalLine, totalUsed };
}

export interface MaturityItem {
  key: string;
  product: string;
  ref: string;
  dueDate: string;
  days: number;
  amount: number;
  route: string;
  bucket: 'overdue' | '30' | '90' | '180' | '365';
}

/** ภาระคืน / ครบกำหนด ภายใน N วัน (default 365) — incl. overdue. */
export async function getMaturityWithin(windowDays = 365): Promise<MaturityItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + windowDays * DAY).toISOString().slice(0, 10);
  const out: MaturityItem[] = [];
  for (const p of PRODUCTS) {
    const { data } = await supabase.from(p.table).select('*');
    for (const r of (data ?? []) as any[]) {
      if (!isOpen(r.status)) continue;
      const due = r[p.dateCol];
      if (!due || due > cutoff) continue;
      const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
      const ref = r.name ?? r[`${p.key}_no`] ?? r.loan_no ?? r.pn_number ?? r.lg_no ?? r.fp_no ?? r.od_no ?? r.tr_no ?? r.fxf_no ?? r.lease_no ?? String(r.id).slice(0, 8);
      const bucket: MaturityItem['bucket'] = days < 0 ? 'overdue' : days <= 30 ? '30' : days <= 90 ? '90' : days <= 180 ? '180' : '365';
      const route = p.key === 'lease' ? `/lease/${r.mode === 'other' ? 'other' : 'hp'}/${r.id}` : `${p.route}/${r.id}`;
      out.push({ key: `${p.table}:${r.id}`, product: p.label, ref, dueDate: due, days, amount: Number(r[p.amountCol] ?? 0), route, bucket });
    }
  }
  out.sort((a, b) => a.days - b.days);
  return out;
}

export interface InterestRow {
  product: string;
  color: string;
  accrued: number;   // accrued interest still on the books
}

/** Interest summary: accrued interest per product (from tx accrued fields where present). */
export async function getInterestSummary(): Promise<InterestRow[]> {
  const out: InterestRow[] = [];
  for (const p of PRODUCTS) {
    const { data } = await supabase.from(p.table).select('*');
    let accrued = 0;
    for (const r of (data ?? []) as any[]) {
      if (!isOpen(r.status)) continue;
      accrued += Number(r.accrued_interest ?? r.accumulated_accrued_interest ?? 0);
    }
    out.push({ product: p.label, color: p.color, accrued });
  }
  return out.filter((r) => r.accrued !== 0);
}

export interface CollateralRow {
  id: string;
  maId: string;
  type: string;
  ref: string;
  appraisal: number;
  value: number;
  drop: boolean;     // book value dropped >10% below appraisal
}

/** Collateral report (MoM: จำแนกตามสถานะหลักประกัน) — from ma_collaterals. */
export async function getCollateralSummary(): Promise<{ rows: CollateralRow[]; totalAppraisal: number; totalValue: number }> {
  const { data } = await supabase.from('ma_collaterals').select('id, ma_id, type, fields');
  const rows: CollateralRow[] = [];
  let totalAppraisal = 0;
  let totalValue = 0;
  for (const r of (data ?? []) as any[]) {
    const f = r.fields ?? {};
    const appraisal = Number(f.appraisal ?? 0);
    const value = Number(f.value ?? 0);
    totalAppraisal += appraisal;
    totalValue += value;
    rows.push({
      id: r.id, maId: r.ma_id, type: r.type ?? '—',
      ref: f.doc_no ?? f.vreg ?? f.acct_no ?? f.reg_no ?? f.desc ?? r.type ?? '—',
      appraisal, value, drop: appraisal > 0 && value > 0 && value < appraisal * 0.9,
    });
  }
  return { rows, totalAppraisal, totalValue };
}

export interface LeaseMovementRow {
  id: string;
  ref: string;
  mode: string;
  assetType: string;
  ageBucket: string;          // ≤1y / ≤2y / ≤5y / >5y
  liabilityBeginning: number; // = principal
  liabilityEnding: number;    // outstanding principal balance
  rouCost: number;            // ROU asset cost (= principal at inception)
  rouNbv: number;             // net book value (straight-line) approx
}

/** Lease Liability + ROU Asset movement (MoM Day4 §12). Derived from leases + lease_schedules. */
export async function getLeaseMovement(): Promise<LeaseMovementRow[]> {
  const { data: leases } = await supabase.from('leases').select('*');
  const rows: LeaseMovementRow[] = [];
  for (const l of (leases ?? []) as any[]) {
    if (!isOpen(l.status)) continue;
    const principal = Number(l.principal ?? 0);
    const term = Number(l.term_months ?? 0);
    // remaining principal from latest schedule row, else principal
    const { data: sched } = await supabase
      .from('lease_schedules').select('principal_balance, period').eq('lease_id', l.id).order('period', { ascending: true });
    const today = new Date();
    let ending = principal;
    let elapsed = 0;
    for (const s of (sched ?? []) as any[]) {
      ending = Number(s.principal_balance ?? ending);
    }
    // crude elapsed months from start_date for straight-line ROU NBV
    if (l.start_date) {
      const sd = new Date(l.start_date);
      elapsed = Math.max(0, Math.min(term, (today.getFullYear() - sd.getFullYear()) * 12 + (today.getMonth() - sd.getMonth())));
    }
    const rouNbv = term > 0 ? Math.max(0, principal * (1 - elapsed / term)) : principal;
    const years = term / 12;
    const ageBucket = years <= 1 ? '≤1 ปี' : years <= 2 ? '≤2 ปี' : years <= 5 ? '≤5 ปี' : '>5 ปี';
    rows.push({
      id: l.id, ref: l.lease_no ?? String(l.id).slice(0, 8), mode: l.mode === 'other' ? 'Lease' : 'HP',
      assetType: l.asset_type ?? '—', ageBucket,
      liabilityBeginning: principal, liabilityEnding: ending,
      rouCost: principal, rouNbv,
    });
  }
  return rows;
}
