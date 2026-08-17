// รายงานมาตรฐาน 6 ฉบับ ตามแบบฟอร์มที่ลูกค้ากำหนด
//   1 สัญญาวงเงิน (Master Agreement)      4 ความเคลื่อนไหวรถ (Car Stock Movement)
//   2 วงเงินสินเชื่อ (Credit Agreement)    5 ครบกำหนดอายุสัญญา (Maturity)
//   3 การใช้วงเงิน (Credit Transaction)    6 การชำระเงิน (Repayment)
//
// ทุกฉบับดึงข้อมูลสดจากตารางจริง ไม่มีการสร้างตารางสรุปแยก

import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────
// ตัวช่วยร่วม
// ─────────────────────────────────────────────────────────────

/** ประเภทสถาบันการเงิน — ธนาคาร / ไม่ใช่ธนาคาร */
export type FiType = 'Bank' | 'Non-Bank';

// รายชื่อผู้ให้กู้ที่ไม่ใช่ธนาคาร (บริษัทลูกของค่ายรถ ฯลฯ)
// TODO: ย้ายไปเก็บที่ตารางผู้ขาย เมื่อได้ข้อมูลจริงจากลูกค้า
const NON_BANK = ['BMW-FS', 'BMW FINANCIAL', 'TOYOTA LEASING', 'MERCEDES-BENZ LEASING'];

export function fiType(code: string | null | undefined): FiType {
  const c = (code ?? '').trim().toUpperCase();
  return NON_BANK.some((n) => c.includes(n)) ? 'Non-Bank' : 'Bank';
}

/** สถานะที่ถือว่าปิดแล้ว — ใช้ร่วมทุกโมดูล */
const CLOSED = ['closed', 'repaid', 'cancelled', 'terminated', 'rejected', 'expired', 'converted'];
export const isOpenStatus = (s: string | null | undefined) =>
  !CLOSED.includes((s ?? '').trim().toLowerCase());

/** อ่านประเภท+อัตราดอกเบี้ยจากบัตรอัตรา (เก็บเป็นรายการในสัญญา) */
function firstRate(rateCards: any): { type: string; rate: number | null } {
  const arr = Array.isArray(rateCards) ? rateCards : [];
  const c = arr[0];
  if (!c) return { type: '—', rate: null };
  const base = Number(c.rate ?? 0);
  const margin = Number(c.condition ?? 0);
  return { type: c.type ?? '—', rate: base + margin };
}

/** ระยะเวลา + หน่วย — บางโมดูลเก็บเป็นวัน บางโมดูลเก็บเป็นเดือน */
function termOf(r: any): { term: number | null; termType: string } {
  if (r.term_days != null) return { term: Number(r.term_days), termType: 'DAYS' };
  if (r.term_months != null) return { term: Number(r.term_months), termType: 'MONTHS' };
  return { term: null, termType: '—' };
}

async function subsidiaryByCa(caIds: string[]) {
  const map = new Map<string, { subsidiary: string; caName: string }>();
  if (caIds.length === 0) return map;
  const { data } = await supabase
    .from('credit_agreements').select('id, subsidiary, ca_name').in('id', caIds);
  for (const c of (data ?? []) as any[]) {
    map.set(c.id, { subsidiary: c.subsidiary ?? '—', caName: c.ca_name ?? '—' });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// 1) รายงานสัญญาวงเงิน (Master Agreement)
// ─────────────────────────────────────────────────────────────
export interface MaReportRow {
  no: number;
  company: string;
  maName: string;
  fiType: FiType;
  fiName: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  deRatio: string;
  dscrRatio: string;
  otherRequirement: string;
  consentWaiver: string;
  guarantee: string;
  collateral: string;
  creditLine: number;
  utilization: number;
  remaining: number;
  childSubsidiary: string;
  childCreditLine: number | null;
  childUtilization: number | null;
  childRemaining: number | null;
}

export async function getMaReport(): Promise<MaReportRow[]> {
  const [{ data: mas }, { data: conds }, { data: subs }, { data: guars }, { data: cols }] =
    await Promise.all([
      supabase.from('master_agreements')
        .select('id, ma_name, subsidiary, finance_institution, start_date, end_date, status, credit_line, utilization, guarantee_remark')
        .order('ma_name'),
      supabase.from('ma_conditions').select('*'),
      supabase.from('ma_subsidiaries').select('*').order('sort_order'),
      supabase.from('ma_guarantors').select('ma_id, type, name, company_name'),
      supabase.from('ma_collaterals').select('ma_id, type, value, appraisal'),
    ]);

  const condMap = new Map(((conds ?? []) as any[]).map((c) => [c.ma_id, c]));
  const subMap = new Map<string, any[]>();
  for (const s of (subs ?? []) as any[]) {
    subMap.set(s.ma_id, [...(subMap.get(s.ma_id) ?? []), s]);
  }
  const guarMap = new Map<string, string[]>();
  for (const g of (guars ?? []) as any[]) {
    const label = g.company_name || g.name || g.type;
    if (label) guarMap.set(g.ma_id, [...(guarMap.get(g.ma_id) ?? []), label]);
  }
  const colMap = new Map<string, string[]>();
  for (const c of (cols ?? []) as any[]) {
    if (c.type) colMap.set(c.ma_id, [...(colMap.get(c.ma_id) ?? []), c.type]);
  }

  const rows: MaReportRow[] = [];
  let no = 0;
  for (const m of (mas ?? []) as any[]) {
    no += 1;
    const cond = condMap.get(m.id);
    const children = subMap.get(m.id) ?? [];
    const base = {
      no,
      company: m.subsidiary ?? '—',
      maName: m.ma_name ?? '—',
      fiType: fiType(m.finance_institution),
      fiName: m.finance_institution ?? '—',
      startDate: m.start_date ?? null,
      endDate: m.end_date ?? null,
      status: m.status ?? '—',
      deRatio: cond?.de_value != null ? `${cond.de_op ?? ''} ${cond.de_value}`.trim() : '—',
      dscrRatio: cond?.dscr_value != null ? `${cond.dscr_op ?? ''} ${cond.dscr_value}`.trim() : '—',
      otherRequirement: cond?.other_requirement || '—',
      consentWaiver: cond?.consent_waiver || '—',
      guarantee: [...new Set(guarMap.get(m.id) ?? [])].join(' · ') || (m.guarantee_remark || '—'),
      collateral: [...new Set(colMap.get(m.id) ?? [])].join(' · ') || '—',
      creditLine: Number(m.credit_line ?? 0),
      utilization: Number(m.utilization ?? 0),
      remaining: Number(m.credit_line ?? 0) - Number(m.utilization ?? 0),
    };

    if (children.length === 0) {
      rows.push({ ...base, childSubsidiary: '—', childCreditLine: null, childUtilization: null, childRemaining: null });
    } else {
      children.forEach((c, i) => {
        rows.push({
          ...base,
          // แถวที่ 2 ขึ้นไปของสัญญาเดียวกัน ปล่อยช่องหลักว่างไว้ — อ่านง่ายเหมือนแบบฟอร์มต้นฉบับ
          ...(i > 0 ? { no: 0 } : {}),
          childSubsidiary: c.subsidiary ?? '—',
          childCreditLine: Number(c.credit_line ?? 0),
          childUtilization: Number(c.utilization ?? 0),
          childRemaining: Number(c.credit_line ?? 0) - Number(c.utilization ?? 0),
        });
      });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────
// 2) รายงานวงเงินสินเชื่อ (Credit Agreement)
// ─────────────────────────────────────────────────────────────
export interface CaReportRow {
  no: number;
  subsidiary: string;
  caName: string;
  caNumber: string;
  maName: string;
  fiType: FiType;
  fiName: string;
  facilityType: string;
  purpose: string;
  creditType: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  interestType: string;
  interestRate: number | null;
  creditLineForeign: number | null;
  currency: string;
  fxRate: number | null;
  creditLine: number;
  utilization: number;
  remaining: number;
}

export async function getCaReport(): Promise<CaReportRow[]> {
  const [{ data: cas }, { data: mas }, { data: fts }] = await Promise.all([
    supabase.from('credit_agreements').select('*').order('ca_name'),
    supabase.from('master_agreements').select('id, ma_name'),
    supabase.from('facility_types').select('id, code, name_th'),
  ]);
  const maMap = new Map(((mas ?? []) as any[]).map((m) => [m.id, m.ma_name]));
  const ftMap = new Map(((fts ?? []) as any[]).map((f) => [f.id, f.code ?? f.name_th]));

  return ((cas ?? []) as any[]).map((c, i) => {
    const r = firstRate(c.rate_cards);
    return {
      no: i + 1,
      subsidiary: c.subsidiary ?? '—',
      caName: c.ca_name ?? '—',
      caNumber: c.contract_number ?? '—',
      maName: c.ma_id ? (maMap.get(c.ma_id) ?? '—') : '—',
      fiType: fiType(c.finance_institution),
      fiName: c.finance_institution ?? '—',
      facilityType: c.facility_type_id ? (ftMap.get(c.facility_type_id) ?? '—') : '—',
      purpose: c.loan_purpose ?? '—',
      creditType: c.credit_type ?? '—',
      startDate: c.start_date ?? null,
      endDate: c.end_date ?? null,
      status: c.status ?? '—',
      interestType: r.type,
      interestRate: r.rate,
      creditLineForeign: c.credit_line_foreign != null ? Number(c.credit_line_foreign) : null,
      currency: c.currency ?? 'THB',
      fxRate: c.fx_rate != null ? Number(c.fx_rate) : null,
      creditLine: Number(c.credit_line ?? 0),
      utilization: Number(c.utilization ?? 0),
      remaining: Number(c.credit_line ?? 0) - Number(c.utilization ?? 0),
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 3) รายงานการใช้วงเงิน (Credit Transaction) — รวม 9 โมดูล
// ─────────────────────────────────────────────────────────────
export interface TxReportRow {
  no: number;
  subsidiary: string;
  txName: string;
  txNumber: string;
  caName: string;
  fiType: FiType;
  fiName: string;
  facilityType: string;
  status: string;
  transactionDate: string | null;
  maturityDate: string | null;
  term: number | null;
  termType: string;
  interestType: string;
  interestRate: number | null;
  amountForeign: number | null;
  currency: string;
  fxRate: number | null;
  amount: number;
  referenceContract: string;
  chassis: string;
}

/** ตั้งค่าต่อโมดูล — ชื่อตาราง · ช่องเลขที่ · ช่องวันครบกำหนด · ช่องจำนวนเงิน */
const TX_SOURCES = [
  { table: 'promissory_notes',  ft: 'P/N',         noCol: 'pn_number',  nameCol: 'name',       due: 'maturity_date', amt: 'amount' },
  { table: 'letter_guarantees', ft: 'L/G',         noCol: 'lg_no',      nameCol: 'name',       due: 'expiry_date',   amt: 'amount' },
  { table: 'letters_of_credit', ft: 'L/C',         noCol: 'lc_no',      nameCol: 'name',       due: 'expiry_date',   amt: 'amount' },
  { table: 'floor_plans',       ft: 'Floor Plan',  noCol: 'fp_no',      nameCol: 'name',       due: 'maturity_date', amt: 'amount' },
  { table: 'overdrafts',        ft: 'O/D',         noCol: 'od_no',      nameCol: 'name',       due: 'end_date',      amt: 'facility_limit' },
  { table: 'trust_receipts',    ft: 'T/R',         noCol: 'tr_no',      nameCol: 'name',       due: 'maturity_date', amt: 'amount' },
  { table: 'fx_forwards',       ft: 'FX Forward',  noCol: 'fxf_no',     nameCol: 'name',       due: 'maturity_date', amt: 'amount' },
  { table: 'loans',             ft: 'Loan',        noCol: 'loan_no',    nameCol: 'name',       due: 'end_date',      amt: 'principal' },
  { table: 'leases',            ft: 'Lease',       noCol: 'lease_no',   nameCol: 'asset_name', due: 'end_date',      amt: 'principal' },
] as const;

export async function getTxReport(): Promise<TxReportRow[]> {
  const all: Omit<TxReportRow, 'no'>[] = [];

  // เลขตัวถังต่อสัญญา — ดึงล่วงหน้าเพื่อเติมในคอลัมน์ Chassis
  const [{ data: fpCh }, { data: loanCh }] = await Promise.all([
    supabase.from('fp_chassis').select('fp_id, chassis_no'),
    supabase.from('loan_chassis').select('loan_id, chassis_no'),
  ]);
  const chassisByFp = new Map<string, string[]>();
  for (const c of (fpCh ?? []) as any[]) chassisByFp.set(c.fp_id, [...(chassisByFp.get(c.fp_id) ?? []), c.chassis_no]);
  const chassisByLoan = new Map<string, string[]>();
  for (const c of (loanCh ?? []) as any[]) chassisByLoan.set(c.loan_id, [...(chassisByLoan.get(c.loan_id) ?? []), c.chassis_no]);

  for (const src of TX_SOURCES) {
    const { data, error } = await supabase.from(src.table).select('*');
    if (error) { console.warn(`[รายงานการใช้วงเงิน] อ่าน ${src.table} ไม่สำเร็จ:`, error.message); continue; }

    const caIds = [...new Set(((data ?? []) as any[]).map((r) => r.ca_id).filter(Boolean))];
    const caMap = await subsidiaryByCa(caIds);

    for (const r of (data ?? []) as any[]) {
      const rate = firstRate(r.rate_cards);
      const t = termOf(r);
      const ca = r.ca_id ? caMap.get(r.ca_id) : undefined;

      let chassis = '';
      if (src.table === 'floor_plans') chassis = (chassisByFp.get(r.id) ?? []).join(', ');
      else if (src.table === 'loans') chassis = (chassisByLoan.get(r.id) ?? []).join(', ');
      else if (src.table === 'promissory_notes') {
        chassis = (Array.isArray(r.chassis_list) ? r.chassis_list : [])
          .map((c: any) => c?.chassis_no).filter(Boolean).join(', ');
      } else if (src.table === 'leases') chassis = r.chassis_no ?? '';

      all.push({
        subsidiary: ca?.subsidiary ?? '—',
        txName: r[src.nameCol] ?? r[src.noCol] ?? '—',
        txNumber: r[src.noCol] ?? '—',
        caName: ca?.caName ?? '—',
        fiType: fiType(r.finance_institution),
        fiName: r.finance_institution ?? '—',
        facilityType: src.ft,
        status: r.status ?? '—',
        transactionDate: r.transaction_date ?? r.issue_date ?? r.start_date ?? null,
        maturityDate: r[src.due] ?? null,
        term: t.term,
        termType: t.termType,
        interestType: rate.type !== '—' ? rate.type
          : (r.effective_rate != null ? 'Fixed' : (r.fee_rate != null ? 'Fee' : '—')),
        interestRate: rate.rate ?? (r.effective_rate ?? r.annual_rate ?? r.fee_rate ?? null),
        amountForeign: r.amount_foreign != null ? Number(r.amount_foreign) : null,
        currency: r.currency ?? 'THB',
        fxRate: r.fx_rate != null ? Number(r.fx_rate) : null,
        amount: Number(r[src.amt] ?? 0),
        referenceContract: r.reference_contract ?? '—',
        chassis: chassis || '—',
      });
    }
  }

  return all
    .sort((a, b) => (b.transactionDate ?? '').localeCompare(a.transactionDate ?? ''))
    .map((r, i) => ({ ...r, no: i + 1 }));
}

// ─────────────────────────────────────────────────────────────
// 4) รายงานความเคลื่อนไหวรถ (Car Stock Movement)
// ─────────────────────────────────────────────────────────────
export interface CarStockRow {
  no: number;
  subsidiary: string;
  chassis: string;
  carModel: string;
  status: string;
  originalLocation: string;
  currentLocation: string;
  fpNumber: string;
  pnNumber: string;
  trNumber: string;
  lnNumber: string;
  latestNumber: string;
  startDate: string | null;
  soldDate: string | null;
  totalPrincipal: number;
}

export async function getCarStockReport(): Promise<CarStockRow[]> {
  const acc = new Map<string, Omit<CarStockRow, 'no'>>();
  const put = (chassis: string, patch: Partial<Omit<CarStockRow, 'no'>>) => {
    const key = (chassis ?? '').trim();
    if (!key) return;
    const cur = acc.get(key) ?? {
      subsidiary: '—', chassis: key, carModel: '—', status: '—',
      originalLocation: '—', currentLocation: '—',
      fpNumber: '—', pnNumber: '—', trNumber: '—', lnNumber: '—', latestNumber: '—',
      startDate: null, soldDate: null, totalPrincipal: 0,
    };
    acc.set(key, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null && v !== '')) } as any);
  };

  // Floor Plan — แหล่งเดียวที่เก็บสถานที่รถ
  const { data: fpCh } = await supabase
    .from('fp_chassis')
    .select('fp_id, chassis_no, model, status, original_location, current_location, receive_date, sold_date, amount');
  const fpIds = [...new Set(((fpCh ?? []) as any[]).map((c) => c.fp_id).filter(Boolean))];
  const { data: fps } = fpIds.length
    ? await supabase.from('floor_plans').select('id, fp_no, name, ca_id').in('id', fpIds)
    : { data: [] as any[] };
  const fpMap = new Map(((fps ?? []) as any[]).map((f) => [f.id, f]));
  const caMapFp = await subsidiaryByCa([...new Set(((fps ?? []) as any[]).map((f) => f.ca_id).filter(Boolean))]);

  for (const c of (fpCh ?? []) as any[]) {
    const fp = fpMap.get(c.fp_id);
    put(c.chassis_no, {
      subsidiary: fp?.ca_id ? caMapFp.get(fp.ca_id)?.subsidiary : undefined,
      carModel: c.model,
      status: c.sold_date ? 'Sold' : (c.status ?? 'Open'),
      originalLocation: c.original_location,
      currentLocation: c.current_location ?? c.original_location,
      fpNumber: fp?.name ?? fp?.fp_no,
      latestNumber: fp?.name ?? fp?.fp_no,
      startDate: c.receive_date,
      soldDate: c.sold_date,
      totalPrincipal: Number(c.amount ?? 0),
    });
  }

  // Loan
  const { data: loanCh } = await supabase.from('loan_chassis').select('loan_id, chassis_no, car_model, location, cost');
  const loanIds = [...new Set(((loanCh ?? []) as any[]).map((c) => c.loan_id).filter(Boolean))];
  const { data: loans } = loanIds.length
    ? await supabase.from('loans').select('id, loan_no, name, ca_id, start_date').in('id', loanIds)
    : { data: [] as any[] };
  const loanMap = new Map(((loans ?? []) as any[]).map((l) => [l.id, l]));
  const caMapLoan = await subsidiaryByCa([...new Set(((loans ?? []) as any[]).map((l) => l.ca_id).filter(Boolean))]);
  for (const c of (loanCh ?? []) as any[]) {
    const l = loanMap.get(c.loan_id);
    put(c.chassis_no, {
      subsidiary: l?.ca_id ? caMapLoan.get(l.ca_id)?.subsidiary : undefined,
      carModel: c.car_model,
      currentLocation: c.location,
      lnNumber: l?.name ?? l?.loan_no,
      latestNumber: l?.name ?? l?.loan_no,
      startDate: l?.start_date,
    });
  }

  // P/N
  const { data: pns } = await supabase
    .from('promissory_notes').select('id, name, pn_number, ca_id, chassis_list, transaction_date');
  const caMapPn = await subsidiaryByCa([...new Set(((pns ?? []) as any[]).map((p) => p.ca_id).filter(Boolean))]);
  for (const p of (pns ?? []) as any[]) {
    for (const c of (Array.isArray(p.chassis_list) ? p.chassis_list : [])) {
      if (!c?.chassis_no) continue;
      put(c.chassis_no, {
        subsidiary: p.ca_id ? caMapPn.get(p.ca_id)?.subsidiary : undefined,
        carModel: c.model ?? c.car_model,
        pnNumber: p.pn_number ?? p.name,
        latestNumber: p.pn_number ?? p.name,
        startDate: p.transaction_date,
      });
    }
  }

  return [...acc.values()]
    .sort((a, b) => a.chassis.localeCompare(b.chassis))
    .map((r, i) => ({ ...r, no: i + 1 }));
}

// ─────────────────────────────────────────────────────────────
// 5) รายงานครบกำหนดอายุสัญญา (Maturity)
// ─────────────────────────────────────────────────────────────
export interface MaturityReportRow extends Omit<TxReportRow, 'caName' | 'referenceContract' | 'chassis'> {
  daysToMaturity: number | null;
}

export async function getMaturityReport(): Promise<MaturityReportRow[]> {
  const tx = await getTxReport();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return tx
    .filter((r) => r.maturityDate && isOpenStatus(r.status))
    .map((r) => {
      const d = new Date(r.maturityDate!);
      const days = Math.round((d.getTime() - today.getTime()) / 86400000);
      const { caName: _c, referenceContract: _r, chassis: _ch, ...rest } = r;
      return { ...rest, daysToMaturity: days };
    })
    .sort((a, b) => (a.daysToMaturity ?? 0) - (b.daysToMaturity ?? 0))
    .map((r, i) => ({ ...r, no: i + 1 }));
}

// ─────────────────────────────────────────────────────────────
// 6) รายงานการชำระเงิน (Repayment)
// ─────────────────────────────────────────────────────────────
export interface RepaymentReportRow {
  no: number;
  subsidiary: string;
  txName: string;
  txNumber: string;
  fiType: FiType;
  fiName: string;
  facilityType: string;
  maturityDate: string | null;
  term: number | null;
  termType: string;
  interestRate: number | null;
  payDate: string | null;
  paidPrincipal: number;
  paidInterest: number;
  accumPrincipal: number;
  accumInterest: number;
  status: string;
}

export async function getRepaymentReport(): Promise<RepaymentReportRow[]> {
  const [{ data: reps }, { data: fts }, tx] = await Promise.all([
    supabase.from('repayments').select('*').order('pay_date'),
    supabase.from('facility_types').select('id, code, name_th'),
    getTxReport(),
  ]);
  const ftMap = new Map(((fts ?? []) as any[]).map((f) => [f.id, f.code ?? f.name_th]));
  // จับคู่ธุรกรรมด้วยเลขที่ เพื่อดึงข้อมูลสัญญามาแสดงในรายงาน
  const txByNo = new Map(tx.map((t) => [t.txNumber, t]));

  // ยอดสะสมต่อสัญญา — เรียงตามวันชำระแล้วบวกสะสมไปเรื่อยๆ
  const accum = new Map<string, { p: number; i: number }>();

  return ((reps ?? []) as any[])
    .filter((r) => (r.status ?? '') !== 'Reversed')
    .map((r, idx) => {
      const key = `${r.facility_type_id}|${r.facility_id}`;
      const cur = accum.get(key) ?? { p: 0, i: 0 };
      const p = Number(r.principal ?? 0);
      const i = Number(r.interest ?? 0);
      cur.p += p; cur.i += i;
      accum.set(key, cur);

      const t = [...txByNo.values()].find((x) => x.txNumber === r.reference_no) ?? undefined;
      return {
        no: idx + 1,
        subsidiary: t?.subsidiary ?? '—',
        txName: t?.txName ?? r.reference_no ?? '—',
        txNumber: r.reference_no ?? '—',
        fiType: t?.fiType ?? 'Bank',
        fiName: t?.fiName ?? '—',
        facilityType: r.facility_type_id ? (ftMap.get(r.facility_type_id) ?? '—') : (t?.facilityType ?? '—'),
        maturityDate: t?.maturityDate ?? null,
        term: t?.term ?? null,
        termType: t?.termType ?? '—',
        interestRate: t?.interestRate ?? null,
        payDate: r.pay_date ?? null,
        paidPrincipal: p,
        paidInterest: i,
        accumPrincipal: cur.p,
        accumInterest: cur.i,
        status: r.status ?? '—',
      };
    })
    .reverse()
    .map((r, i) => ({ ...r, no: i + 1 }));
}
