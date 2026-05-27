// Notification feed: แจ้งล่วงหน้าก่อนครบกำหนด/หมดอายุ ทุกผลิตภัณฑ์
// PN maturity · LG/BG expiry · Floor Plan · O/D facility · T/R · FX Forward · Loan · Lease/HP
// Derived live from each transaction table's maturity/end/due date.
import { supabase } from './supabase';

export type NotiSeverity = 'overdue' | 'soon' | 'upcoming';

export type NotiCategory = 'maturity' | 'collateral' | 'release';

export interface NotiItem {
  key: string;
  kind: string; // product label
  ref: string; // contract identifier
  dueDate: string;
  days: number; // days until due (negative = overdue)
  severity: NotiSeverity;
  route: string;
  category: NotiCategory;
  note?: string; // custom display note (overrides days-based text)
}

interface Src {
  table: string;
  dateCol: string;
  kind: string;
  refCols: string[];
  route: (r: any) => string;
  closed: string[]; // statuses that no longer need a reminder
}

const SOURCES: Src[] = [
  { table: 'promissory_notes', dateCol: 'maturity_date', kind: 'P/N ครบกำหนด', refCols: ['name', 'pn_number'], route: (r) => `/tx/pn/${r.id}`, closed: ['Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'letter_guarantees', dateCol: 'expiry_date', kind: 'LG/BG หมดอายุ', refCols: ['lg_no', 'name'], route: (r) => `/tx/lg/${r.id}`, closed: ['Closed', 'Cancelled', 'Terminated', 'Expired', 'Roll Over'] },
  { table: 'floor_plans', dateCol: 'maturity_date', kind: 'Floor Plan ครบกำหนด', refCols: ['fp_no', 'name'], route: (r) => `/tx/fp/${r.id}`, closed: ['Closed', 'Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'overdrafts', dateCol: 'end_date', kind: 'O/D หมดอายุวงเงิน', refCols: ['od_no', 'account_no', 'name'], route: (r) => `/tx/od/${r.id}`, closed: ['Closed', 'Cancelled'] },
  { table: 'trust_receipts', dateCol: 'due_date', kind: 'T/R ครบกำหนด', refCols: ['tr_no', 'name'], route: (r) => `/tx/tr/${r.id}`, closed: ['Closed', 'Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'fx_forwards', dateCol: 'maturity_date', kind: 'FX Forward ครบกำหนด', refCols: ['fxf_no', 'name'], route: (r) => `/tx/fxf/${r.id}`, closed: ['Settled', 'Closed', 'Cancelled'] },
  { table: 'loans', dateCol: 'installment_end_date', kind: 'Loan ครบกำหนด', refCols: ['name', 'loan_no'], route: (r) => `/tx/loan/${r.id}`, closed: ['Closed', 'Modified', 'Cancelled', 'Rejected'] },
  { table: 'leases', dateCol: 'end_date', kind: 'Lease/HP ครบกำหนด', refCols: ['lease_no'], route: (r) => `/lease/${r.mode === 'hp' ? 'hp' : 'other'}/${r.id}`, closed: ['Closed', 'Modified', 'Roll Over'] },
  // NTF-MA-003 — Master Agreement ใกล้สิ้นสุดอายุ (เพื่อเตรียมเอกสารต่อสัญญา)
  { table: 'master_agreements', dateCol: 'end_date', kind: 'Master Agreement ใกล้สิ้นสุด', refCols: ['ma_name'], route: (r) => `/ma/${r.id}`, closed: ['Expired', 'Terminated', 'Rejected'] },
];

const DAY = 86400000;

/** Scan all transaction tables for items maturing within `windowDays` (incl. overdue). */
export async function getMaturityNotifications(windowDays = 30): Promise<NotiItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() + windowDays * DAY).toISOString().slice(0, 10);
  const out: NotiItem[] = [];

  for (const s of SOURCES) {
    const closedList = `(${s.closed.map((x) => `"${x}"`).join(',')})`;
    const { data, error } = await supabase
      .from(s.table)
      .select('*')
      .not('status', 'in', closedList)
      .not(s.dateCol, 'is', null)
      .lte(s.dateCol, cutoff);
    if (error || !data) continue;
    for (const r of data as any[]) {
      const due = r[s.dateCol];
      if (!due) continue;
      const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
      const severity: NotiSeverity = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming';
      const ref = s.refCols.map((c) => r[c]).find((v) => v) ?? String(r.id ?? '').slice(0, 8) ?? '—';
      out.push({ key: `${s.table}:${r.id}`, kind: s.kind, ref, dueDate: due, days, severity, route: s.route(r), category: 'maturity' });
    }
  }
  out.sort((a, b) => a.days - b.days);
  return out;
}

const addMonths = (iso: string, m: number) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth() + m, d.getDate()).toISOString().slice(0, 10);
};

/** collateral re-appraisal due (cycle 12mo) + value-drop (book value < appraised). */
export async function getCollateralNotifications(windowDays = 30, reviewMonths = 12): Promise<NotiItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('ma_collaterals').select('id, ma_id, type, fields');
  const out: NotiItem[] = [];
  for (const r of (data ?? []) as any[]) {
    const f = r.fields ?? {};
    const ref = f.doc_no ?? f.vreg ?? f.acct_no ?? f.reg_no ?? f.desc ?? r.type ?? '—';
    const route = `/ma/${r.ma_id}`;
    const appraisal = Number(f.appraisal ?? 0);
    const value = Number(f.value ?? 0);

    // re-appraisal cycle
    if (f.appr_date) {
      const nextISO = addMonths(f.appr_date, reviewMonths);
      const days = Math.round((new Date(nextISO).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
      if (days <= windowDays) {
        out.push({
          key: `col-review:${r.id}`, kind: 'หลักประกัน — ถึงรอบประเมินใหม่', ref, dueDate: nextISO, days,
          severity: days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming', route, category: 'collateral',
        });
      }
    }
    // value drop (book/current VALUE dropped below APPRAISAL by >10%)
    if (appraisal > 0 && value > 0 && value < appraisal * 0.9) {
      out.push({
        key: `col-drop:${r.id}`, kind: 'หลักประกัน — มูลค่าลดลง', ref, dueDate: f.appr_date ?? today.toISOString().slice(0, 10),
        days: 0, severity: 'soon', route, category: 'collateral',
        note: `มูลค่า ${value.toLocaleString()} ต่ำกว่าราคาประเมิน ${appraisal.toLocaleString()} — กระทบ Coverage/วงเงิน`,
      });
    }
  }
  return out;
}

/** Chassis collateral release notifications when transaction is fully repaid/closed.
 * Covers: P/N · Floor Plan · Loan. (HP/Lease use Asset Transfer flow, not release.) */
export async function getReleaseNotifications(): Promise<NotiItem[]> {
  const out: NotiItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // P/N — chassis_list stored as JSON column on promissory_notes
  const { data: pns } = await supabase
    .from('promissory_notes')
    .select('id, name, pn_number, chassis_list')
    .eq('status', 'Repaid');
  for (const r of (pns ?? []) as any[]) {
    const chassis = Array.isArray(r.chassis_list) ? r.chassis_list : [];
    if (chassis.length === 0) continue;
    const nos = chassis.map((c: any) => c?.chassis_no).filter(Boolean);
    out.push({
      key: `release:pn:${r.id}`, kind: 'ปลดหลักประกันรถ — P/N (แจ้ง Finance)',
      ref: r.name ?? r.pn_number ?? r.id,
      dueDate: today, days: 0, severity: 'soon', route: `/tx/pn/${r.id}`,
      category: 'release',
      note: `P/N ชำระครบ — ปลดได้ ${chassis.length} คัน · ${nos.length ? nos.join(', ') : '—'}`,
    });
  }

  // Floor Plan — chassis in fp_chassis table, release when fp is closed/repaid
  const { data: fps } = await supabase
    .from('floor_plans')
    .select('id, fp_no, name, status')
    .in('status', ['Repaid', 'Closed']);
  for (const r of (fps ?? []) as any[]) {
    const { data: ch } = await supabase.from('fp_chassis').select('chassis_no').eq('fp_id', r.id);
    const chassis = (ch ?? []) as any[];
    if (chassis.length === 0) continue;
    const nos = chassis.map((c) => c.chassis_no).filter(Boolean);
    out.push({
      key: `release:fp:${r.id}`, kind: 'ปลดหลักประกันรถ — Floor Plan (แจ้ง Finance)',
      ref: r.fp_no ?? r.name ?? r.id,
      dueDate: today, days: 0, severity: 'soon', route: `/tx/fp/${r.id}`,
      category: 'release',
      note: `Floor Plan ปิด — ปลดได้ ${chassis.length} คัน · ${nos.length ? nos.slice(0, 5).join(', ') + (nos.length > 5 ? `, +${nos.length-5}` : '') : '—'}`,
    });
  }

  // Loan — chassis in loan_chassis table, release when loan is closed
  const { data: loans } = await supabase
    .from('loans')
    .select('id, loan_no, name, status')
    .eq('status', 'Closed');
  for (const r of (loans ?? []) as any[]) {
    const { data: ch } = await supabase.from('loan_chassis').select('chassis_no').eq('loan_id', r.id);
    const chassis = (ch ?? []) as any[];
    if (chassis.length === 0) continue;
    const nos = chassis.map((c) => c.chassis_no).filter(Boolean);
    out.push({
      key: `release:loan:${r.id}`, kind: 'ปลดหลักประกันรถ — Loan (แจ้ง Finance)',
      ref: r.loan_no ?? r.name ?? r.id,
      dueDate: today, days: 0, severity: 'soon', route: `/tx/loan/${r.id}`,
      category: 'release',
      note: `Loan ปิด — ปลดได้ ${chassis.length} คัน · ${nos.length ? nos.slice(0, 5).join(', ') + (nos.length > 5 ? `, +${nos.length-5}` : '') : '—'}`,
    });
  }

  return out;
}

/** Combined feed for the Notifications page + header bell. */
export async function getAllNotifications(windowDays = 30): Promise<NotiItem[]> {
  const [a, b, c] = await Promise.all([
    getMaturityNotifications(windowDays),
    getCollateralNotifications(windowDays),
    getReleaseNotifications(),
  ]);
  return [...a, ...b, ...c].sort((x, y) => x.days - y.days);
}
