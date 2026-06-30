// Notification feed: แจ้งล่วงหน้าก่อนครบกำหนด/หมดอายุ ทุกผลิตภัณฑ์
// PN maturity · LG/BG expiry · Floor Plan · O/D facility · T/R · FX Forward · Loan · Lease/HP
// Derived live from each transaction table's maturity/end/due date.
import { supabase } from './supabase';

export type NotiSeverity = 'overdue' | 'soon' | 'upcoming';

export type NotiCategory = 'maturity' | 'collateral' | 'release' | 'curtailment' | 'periodic_je';

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
  const cutoffDate = new Date(today.getTime() + windowDays * DAY);
  // Local-timezone-safe ISO for date comparison with DB values.
  const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
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
  const r = new Date(d.getFullYear(), d.getMonth() + m, d.getDate());
  // Local-timezone-safe ISO.
  return `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-${String(r.getDate()).padStart(2, '0')}`;
};

/** collateral re-appraisal due (cycle 12mo) + value-drop (book value < appraised).
 * Scans both MA-level collaterals AND CA-level overrides so CA-level edits trigger notifications too. */
export async function getCollateralNotifications(windowDays = 30, reviewMonths = 12): Promise<NotiItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: NotiItem[] = [];

  type Source = {
    table: 'ma_collaterals' | 'ca_collaterals';
    fkCol: 'ma_id' | 'ca_id';
    routePrefix: '/ma' | '/ca';
    levelLabel: 'MA' | 'CA';
  };
  const sources: Source[] = [
    { table: 'ma_collaterals', fkCol: 'ma_id', routePrefix: '/ma', levelLabel: 'MA' },
    { table: 'ca_collaterals', fkCol: 'ca_id', routePrefix: '/ca', levelLabel: 'CA' },
  ];

  for (const src of sources) {
    const { data } = await supabase.from(src.table).select(`id, ${src.fkCol}, type, fields`);
    for (const r of (data ?? []) as any[]) {
      const f = r.fields ?? {};
      const baseRef = f.doc_no ?? f.vreg ?? f.acct_no ?? f.reg_no ?? f.desc ?? r.type ?? '—';
      const ref = `[${src.levelLabel}] ${baseRef}`;
      const parentId = r[src.fkCol];
      const route = `${src.routePrefix}/${parentId}`;
      const appraisal = Number(f.appraisal ?? 0);
      const value = Number(f.value ?? 0);

      // re-appraisal cycle (12 months)
      if (f.appr_date) {
        const nextISO = addMonths(f.appr_date, reviewMonths);
        const days = Math.round((new Date(nextISO).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
        if (days <= windowDays) {
          out.push({
            key: `col-review:${src.levelLabel}:${r.id}`, kind: 'หลักประกัน — ถึงรอบประเมินใหม่',
            ref, dueDate: nextISO, days,
            severity: days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming',
            route, category: 'collateral',
          });
        }
      }
      // value drop (current value < appraisal × 0.9 = drop > 10%)
      if (appraisal > 0 && value > 0 && value < appraisal * 0.9) {
        out.push({
          key: `col-drop:${src.levelLabel}:${r.id}`, kind: 'หลักประกัน — มูลค่าลดลง',
          ref, dueDate: f.appr_date ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
          days: 0, severity: 'soon', route, category: 'collateral',
          note: `มูลค่า ${value.toLocaleString()} ต่ำกว่าราคาประเมิน ${appraisal.toLocaleString()} — กระทบ Coverage/วงเงิน`,
        });
      }
    }
  }
  return out;
}

/** Chassis collateral release notifications when transaction is fully repaid/closed.
 * Covers: P/N · Floor Plan · Loan. (HP/Lease use Asset Transfer flow, not release.) */
export async function getReleaseNotifications(): Promise<NotiItem[]> {
  const out: NotiItem[] = [];
  const t = new Date();
  // Local-timezone-safe today.
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

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

/** Floor Plan Curtailment milestones approaching due / overdue (TOR — Outstanding alert เฉพาะ Curtailment).
 * Per MoM Day 1 §5.3 — แจ้งล่วงหน้า 30/15/7 วันก่อนรอบ curtailment milestone ครบกำหนด.
 * Match curtailment master by vendor + transaction_date in effective range (BMW mode only). */
export async function getCurtailmentNotifications(windowDays = 30): Promise<NotiItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const out: NotiItem[] = [];

  // 1) Get active BMW-mode floor plans (curtailment applies only to bmw schedule_mode)
  const { data: fps, error: fpErr } = await supabase
    .from('floor_plans')
    .select('id, fp_no, name, vendor, transaction_date, total_amount, amount, schedule_mode, status')
    .eq('schedule_mode', 'bmw')
    .not('status', 'in', '("Closed","Repaid","Cancelled","Roll Over")')
    .not('transaction_date', 'is', null)
    .not('vendor', 'is', null);
  if (fpErr || !fps || fps.length === 0) return out;

  // 2) Get all active curtailment masters once
  const { data: cms, error: cmErr } = await supabase
    .from('curtailments')
    .select('*')
    .eq('status', 'Active');
  if (cmErr || !cms) return out;

  for (const fp of fps as any[]) {
    const txDate = fp.transaction_date as string;
    if (!txDate) continue;

    // Match curtailment by vendor + tx_date within effective range
    const match = (cms as any[]).find((c) => {
      if (c.vendor !== fp.vendor) return false;
      if (txDate < c.effective_start_date) return false;
      if (c.effective_end_date && txDate > c.effective_end_date) return false;
      return true;
    });
    if (!match) continue;

    // Collect tier milestones (up to 6)
    const milestones: { tier: number; day: number; pct: number }[] = [];
    for (let t = 1; t <= 6; t++) {
      const d = match[`tier${t}_days`];
      const p = match[`tier${t}_pct`];
      if (d != null && p != null) milestones.push({ tier: t, day: d, pct: p });
    }
    if (milestones.length === 0) continue;
    milestones.sort((a, b) => a.day - b.day);

    const baseAmount = Number(fp.total_amount ?? fp.amount ?? 0);
    const txMs = new Date(txDate).setHours(0, 0, 0, 0);
    const ref = fp.fp_no || fp.name || String(fp.id).slice(0, 8);

    // For each milestone — push notification if its due date is within window or overdue
    for (const m of milestones) {
      const dueMs = txMs + m.day * DAY;
      const days = Math.round((dueMs - todayMs) / DAY);
      // Only surface if within window (overdue or upcoming ≤ windowDays)
      if (days > windowDays) continue;
      const dueDate = new Date(dueMs);
      const dueISO = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
      const requiredAmt = (baseAmount * m.pct) / 100;
      const severity: NotiSeverity = days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming';
      const note =
        days < 0
          ? `Curtailment Tier ${m.tier} เกินกำหนด ${Math.abs(days)} วัน — ต้องชำระ ${m.pct}% (${requiredAmt.toLocaleString('en-US', { maximumFractionDigits: 0 })} THB)`
          : `Curtailment Tier ${m.tier} ครบกำหนดใน ${days} วัน — ต้องชำระ ${m.pct}% (${requiredAmt.toLocaleString('en-US', { maximumFractionDigits: 0 })} THB)`;
      out.push({
        key: `curtailment:${fp.id}:t${m.tier}`,
        kind: 'Curtailment ครบกำหนด',
        ref,
        dueDate: dueISO,
        days,
        severity,
        route: `/tx/fp/${fp.id}`,
        category: 'curtailment',
        note,
      });
    }
  }
  out.sort((a, b) => a.days - b.days);
  return out;
}

/** A3 — แจ้ง periodic JE ที่ครบกำหนดวันแล้วแต่ยังไม่ post (Loan/PN/FP/Lease).
 * ทำหน้าที่เหมือน "Daily Accrual reminder" — ทุกครั้งที่ user เปิดแอป ระบบจะตรวจสอบให้
 * Rule (per workshop): ตั้งดอกเบี้ยค้างจ่ายเข้า GL รายเดือน · ในระบบคำนวณรายวัน */
export async function getPendingPeriodicJENotifications(): Promise<NotiItem[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const out: NotiItem[] = [];

  // ดึง JE source_types ที่เป็น "periodic" (Accrued / Periodic / Depreciation)
  const PERIODIC_TYPES = ['LOAN_ACCRUED', 'PN_ACCRUED', 'FP_ACCRUED', 'LEASE_PAY', 'LEASE_DEPR', 'HP_PAYMENT'];

  // Find facilities that have schedule rows due but no posted JE for that period
  // Strategy: scan journal_entries for periods ≤ today with no Posted record
  // We use schedule tables to find expected periods, then cross-check against JE
  type Pending = { facility_id: string; facility_no: string; period: number; due_date: string; module: string };

  // 1) Loan schedules
  const { data: loanSch } = await supabase
    .from('loan_schedules')
    .select('loan_id, period, due_date, loans!inner(loan_no, status)')
    .lte('due_date', todayISO)
    .in('loans.status', ['Active', 'Approved'])
    .limit(500);
  // 2) Loan JEs posted
  const { data: loanJE } = await supabase
    .from('journal_entries')
    .select('source_id, source_period')
    .eq('source_type', 'LOAN_ACCRUED')
    .eq('status', 'Posted');
  const loanPosted = new Set((loanJE ?? []).map((r: any) => `${r.source_id}:${r.source_period}`));
  (loanSch ?? []).forEach((s: any) => {
    const key = `${s.loan_id}:${s.period}`;
    if (loanPosted.has(key)) return;
    const days = Math.round((new Date(s.due_date).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
    const severity: NotiSeverity = days < -7 ? 'overdue' : days < 0 ? 'soon' : 'upcoming';
    out.push({
      key: `je-pending:loan:${s.loan_id}:${s.period}`,
      kind: 'Loan — รอ Post ดอกเบี้ยค้างจ่าย',
      ref: s.loans?.loan_no || s.loan_id,
      dueDate: s.due_date,
      days,
      severity,
      route: `/tx/loan/${s.loan_id}`,
      category: 'periodic_je',
      note: `งวด ${s.period} · เกินกำหนด ${Math.abs(days)} วัน · กด Post JE`,
    });
  });

  out.sort((a, b) => a.days - b.days);
  // Limit to most pressing to avoid overwhelming UI
  return out.slice(0, 50);
}

/** Combined feed for the Notifications page + header bell. */
export async function getAllNotifications(windowDays = 30): Promise<NotiItem[]> {
  const [a, b, c, d, e] = await Promise.all([
    getMaturityNotifications(windowDays),
    getCollateralNotifications(windowDays),
    getReleaseNotifications(),
    getCurtailmentNotifications(windowDays),
    getPendingPeriodicJENotifications(),
  ]);
  return [...a, ...b, ...c, ...d, ...e].sort((x, y) => x.days - y.days);
}
