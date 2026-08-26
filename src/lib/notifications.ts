// ศูนย์รวมการแจ้งเตือนของทั้งระบบ — คำนวณสดจากข้อมูลจริงทุกครั้งที่เปิดหน้าจอ
//
// 7 หมวด: รออนุมัติ · รอลงบัญชี · ถึงรอบชำระคืนบางส่วน · รถที่ขายแล้ว ·
//         ปลดหลักประกัน · สัญญา/วงเงินใกล้ครบกำหนด · หลักประกัน
//
// ทุกฟังก์ชันคืนทั้งรายการ ข้อผิดพลาด และจำนวนที่ถูกตัด เพื่อให้หน้าจอบอกผู้ใช้ได้
// ว่า "ไม่มีรายการ" กับ "ดึงข้อมูลไม่สำเร็จ" ต่างกัน — เดิมกลืนข้อผิดพลาดทิ้งหมด
import { supabase } from './supabase';
import { leaseRoute, LEASE_MENU_KEY, type LeaseMode } from '@/lib/lease-kind';

export type NotiSeverity = 'overdue' | 'soon' | 'upcoming';

export type NotiCategory =
  | 'approval'
  | 'periodic_je'
  | 'curtailment'
  | 'chassis_sold'
  | 'release'
  | 'maturity'
  | 'collateral';

export interface NotiItem {
  key: string;
  kind: string; // ชื่อประเภทที่ผู้ใช้เห็น
  ref: string; // เลขที่สัญญา (ขึ้นก่อนเสมอ แล้วค่อยตามด้วยชื่อเรียก)
  dueDate: string;
  days: number; // จำนวนวันจากวันนี้ (ติดลบ = ผ่านมาแล้ว)
  severity: NotiSeverity;
  route: string;
  category: NotiCategory;
  note?: string; // ข้อความอธิบายเพิ่ม (ถ้ามี จะแทนข้อความจำนวนวัน)
  menuKey?: string; // รหัสเมนู — ใช้กรองตามสิทธิ์ผู้ใช้
}

/** ผลรวมของการแจ้งเตือน — แยกข้อผิดพลาดและจำนวนที่ถูกตัดออกมาให้หน้าจอแสดงได้ */
export interface NotiResult {
  items: NotiItem[];
  errors: string[];
  truncated: number;
}

/** ผลของแต่ละหมวดก่อนนำมารวม */
interface NotiPart {
  items: NotiItem[];
  errors: string[];
  truncated?: number;
}

/** รหัสเมนูทั้งหมดที่มีการแจ้งเตือน — หน้าจอเอาไปกรองด้วย can() ก่อนส่งเข้ามา */
export const NOTI_MENU_KEYS = [
  'ma', 'ca', 'pn', 'lg', 'lc', 'fp', 'od', 'tr', 'fxf', 'loan',
  'lease_hp', 'lease_leasing', 'lease_other',
] as const;

const DAY = 86400000;

/** วันที่ตามเครื่องผู้ใช้ — ห้ามใช้ toISOString() เพราะช่วงเช้ามืดจะได้วันที่ย้อนไป 1 วัน */
function localISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(iso: string, today: Date): number {
  return Math.round((new Date(iso).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
}

const bySeverity = (days: number): NotiSeverity => (days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming');

// =====================================================================
// 1) สัญญา/วงเงิน ใกล้ครบกำหนด
// =====================================================================
interface Src {
  table: string;
  dateCol: string;
  kind: string;
  refCols: string[];
  route: (r: any) => string;
  menu: string | ((r: any) => string);
  closed: string[]; // สถานะที่จบแล้ว ไม่ต้องเตือน
}

const SOURCES: Src[] = [
  // เลขที่สัญญาต้องขึ้นก่อนชื่อเรียกให้เหมือนกันทุกโมดูล ผู้ใช้จะได้กวาดตาหาเจอ
  { table: 'promissory_notes', dateCol: 'maturity_date', kind: 'P/N ครบกำหนด', refCols: ['pn_number', 'name'], route: (r) => `/tx/pn/${r.id}`, menu: 'pn', closed: ['Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'letter_guarantees', dateCol: 'expiry_date', kind: 'LG/BG หมดอายุ', refCols: ['lg_no', 'name'], route: (r) => `/tx/lg/${r.id}`, menu: 'lg', closed: ['Closed', 'Cancelled', 'Terminated', 'Expired', 'Roll Over'] },
  // เลตเตอร์ออฟเครดิตหมดอายุแล้วต้องรีบจัดการ แต่เดิมไม่มีการแจ้งเตือนเลย
  { table: 'letters_of_credit', dateCol: 'expiry_date', kind: 'L/C หมดอายุ', refCols: ['lc_no', 'name'], route: (r) => `/tx/lc/${r.id}`, menu: 'lc', closed: ['Converted', 'Expired', 'Closed', 'Cancelled'] },
  { table: 'floor_plans', dateCol: 'maturity_date', kind: 'Floor Plan ครบกำหนด', refCols: ['fp_no', 'name'], route: (r) => `/tx/fp/${r.id}`, menu: 'fp', closed: ['Closed', 'Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'overdrafts', dateCol: 'end_date', kind: 'O/D หมดอายุวงเงิน', refCols: ['od_no', 'account_no', 'name'], route: (r) => `/tx/od/${r.id}`, menu: 'od', closed: ['Closed', 'Cancelled'] },
  { table: 'trust_receipts', dateCol: 'due_date', kind: 'T/R ครบกำหนด', refCols: ['tr_no', 'name'], route: (r) => `/tx/tr/${r.id}`, menu: 'tr', closed: ['Closed', 'Repaid', 'Cancelled', 'Roll Over'] },
  { table: 'fx_forwards', dateCol: 'maturity_date', kind: 'FX Forward ครบกำหนด', refCols: ['fxf_no', 'name'], route: (r) => `/tx/fxf/${r.id}`, menu: 'fxf', closed: ['Settled', 'Closed', 'Cancelled'] },
  { table: 'loans', dateCol: 'installment_end_date', kind: 'Loan ครบกำหนด', refCols: ['loan_no', 'name'], route: (r) => `/tx/loan/${r.id}`, menu: 'loan', closed: ['Closed', 'Modified', 'Cancelled', 'Rejected'] },
  // Cancelled ต้องอยู่ในรายการสถานะที่จบแล้ว ไม่งั้นสัญญาที่ยกเลิกไปแล้วยังขึ้นเตือนครบกำหนด
  { table: 'leases', dateCol: 'end_date', kind: 'สัญญาเช่าครบกำหนด', refCols: ['lease_no'], route: (r) => leaseRoute(r.mode, r.id), menu: (r) => LEASE_MENU_KEY[r.mode as LeaseMode] ?? 'lease_hp', closed: ['Closed', 'Modified', 'Roll Over', 'Cancelled'] },
  // สัญญาหลักที่ยังเป็นร่างยังไม่มีผลผูกพัน — เตือนต่ออายุไปก็ไม่มีอะไรให้ทำ
  { table: 'master_agreements', dateCol: 'end_date', kind: 'Master Agreement ใกล้สิ้นสุด', refCols: ['ma_name'], route: (r) => `/ma/${r.id}`, menu: 'ma', closed: ['Draft', 'Expired', 'Terminated', 'Rejected'] },
  // วงเงินก็ต้องเตรียมเอกสารต่ออายุเหมือนสัญญาหลัก แต่เดิมไม่มีการแจ้งเตือน
  { table: 'credit_agreements', dateCol: 'end_date', kind: 'Credit Agreement ใกล้สิ้นสุด', refCols: ['ca_name'], route: (r) => `/ca/${r.id}`, menu: 'ca', closed: ['Draft', 'Expired', 'Terminated', 'Rejected', 'Closed'] },
];

async function getMaturityNotifications(windowDays: number): Promise<NotiPart> {
  const today = startOfToday();
  const cutoff = localISO(new Date(today.getTime() + windowDays * DAY));
  const items: NotiItem[] = [];
  const errors: string[] = [];

  for (const s of SOURCES) {
    const closedList = `(${s.closed.map((x) => `"${x}"`).join(',')})`;
    const { data, error } = await supabase
      .from(s.table)
      .select('*')
      .not('status', 'in', closedList)
      .not(s.dateCol, 'is', null)
      .lte(s.dateCol, cutoff);
    if (error) {
      errors.push(`ดึงข้อมูล ${s.kind} ไม่สำเร็จ (${error.message})`);
      continue;
    }
    for (const r of (data ?? []) as any[]) {
      const due = r[s.dateCol];
      if (!due) continue;
      const days = daysUntil(due, today);
      const ref = s.refCols.map((c) => r[c]).find((v) => v) ?? String(r.id ?? '').slice(0, 8) ?? '—';
      items.push({
        key: `${s.table}:${r.id}`,
        kind: s.kind,
        ref,
        dueDate: due,
        days,
        severity: bySeverity(days),
        route: s.route(r),
        category: 'maturity',
        menuKey: typeof s.menu === 'function' ? s.menu(r) : s.menu,
      });
    }
  }
  items.sort((a, b) => a.days - b.days);
  return { items, errors };
}

// =====================================================================
// 2) หลักประกัน — ถึงรอบประเมินใหม่ · มูลค่าตามบัญชีต่ำกว่าราคาประเมิน
// =====================================================================
const addMonths = (iso: string, m: number) => {
  const d = new Date(iso);
  const r = new Date(d.getFullYear(), d.getMonth() + m, d.getDate());
  return localISO(r);
};

/** สถานะของสัญญาแม่ที่แปลว่าจบแล้ว — หลักประกันของสัญญาเหล่านี้ไม่ต้องเตือนอีก */
const PARENT_ENDED = ['Expired', 'Terminated', 'Rejected', 'Closed', 'Cancelled'];

const collateralRef = (r: any): string => {
  const f = r.fields ?? {};
  return String(f.doc_no ?? f.vreg ?? f.acct_no ?? f.reg_no ?? f.desc ?? r.type ?? '—');
};

/**
 * หลักประกันของสัญญาหลักถูกคัดลอกต่อไปที่วงเงินด้วย — เดิมสแกนทั้งสองตาราง
 * ทำให้หลักประกันชิ้นเดียวขึ้นซ้ำ 2 แถว จึงยุบด้วยกุญแจ (สัญญาหลัก + ชนิด + เลขอ้างอิง)
 * ถ้าเป็นหลักประกันที่มีเฉพาะระดับวงเงิน จะแสดงเลขที่วงเงินกำกับให้ชัด
 */
async function getCollateralNotifications(windowDays: number, reviewMonths = 12): Promise<NotiPart> {
  const today = startOfToday();
  const items: NotiItem[] = [];
  const errors: string[] = [];

  const [maCol, caCol, maRows, caRows] = await Promise.all([
    supabase.from('ma_collaterals').select('id, ma_id, type, fields'),
    supabase.from('ca_collaterals').select('id, ca_id, type, fields'),
    supabase.from('master_agreements').select('id, ma_name, status'),
    supabase.from('credit_agreements').select('id, ca_name, status, ma_id'),
  ]);
  for (const [label, res] of [
    ['หลักประกันของสัญญาหลัก', maCol],
    ['หลักประกันของวงเงิน', caCol],
    ['สัญญาหลัก', maRows],
    ['วงเงิน', caRows],
  ] as const) {
    if (res.error) errors.push(`ดึงข้อมูล ${label} ไม่สำเร็จ (${res.error.message})`);
  }

  const maMap = new Map(((maRows.data ?? []) as any[]).map((r) => [r.id, r]));
  const caMap = new Map(((caRows.data ?? []) as any[]).map((r) => [r.id, r]));

  interface Entry { idKey: string; rowKey: string; ref: string; route: string; menuKey: string; fields: any }
  const merged = new Map<string, Entry>();

  // ระดับสัญญาหลักมาก่อน — ถ้าวงเงินมีชิ้นเดียวกันจะถูกยุบเข้ากับแถวนี้
  for (const r of (maCol.data ?? []) as any[]) {
    const ma = maMap.get(r.ma_id);
    if (!ma || PARENT_ENDED.includes(String(ma.status))) continue;
    const base = collateralRef(r);
    const idKey = `ma:${r.ma_id}|${r.type ?? ''}|${base}`;
    merged.set(idKey, {
      idKey,
      rowKey: `ma-col:${r.id}`,
      ref: `${ma.ma_name ?? '—'} · ${base}`,
      route: `/ma/${r.ma_id}`,
      menuKey: 'ma',
      fields: r.fields ?? {},
    });
  }
  for (const r of (caCol.data ?? []) as any[]) {
    const ca = caMap.get(r.ca_id);
    if (!ca || PARENT_ENDED.includes(String(ca.status))) continue;
    const base = collateralRef(r);
    // ถ้าคัดลอกมาจากสัญญาหลักฉบับเดียวกัน ให้ถือว่าเป็นหลักประกันชิ้นเดียวกัน
    const idKey = ca.ma_id ? `ma:${ca.ma_id}|${r.type ?? ''}|${base}` : `ca:${ca.id}|${r.type ?? ''}|${base}`;
    if (merged.has(idKey)) continue;
    merged.set(idKey, {
      idKey,
      rowKey: `ca-col:${r.id}`,
      ref: `${ca.ca_name ?? '—'} (วงเงิน) · ${base}`,
      route: `/ca/${r.ca_id}`,
      menuKey: 'ca',
      fields: r.fields ?? {},
    });
  }

  for (const e of merged.values()) {
    const f = e.fields;
    const appraisal = Number(f.appraisal ?? 0);
    const value = Number(f.value ?? 0);

    // รอบประเมินใหม่ (ทุก 12 เดือนนับจากวันประเมินล่าสุด)
    if (f.appr_date) {
      const nextISO = addMonths(f.appr_date, reviewMonths);
      const days = daysUntil(nextISO, today);
      if (days <= windowDays) {
        items.push({
          key: `col-review:${e.rowKey}`,
          kind: 'หลักประกัน — ถึงรอบประเมินใหม่',
          ref: e.ref,
          dueDate: nextISO,
          days,
          severity: bySeverity(days),
          route: e.route,
          category: 'collateral',
          menuKey: e.menuKey,
        });
      }
    }

    // ระบบไม่มีมูลค่าย้อนหลังให้เทียบ จึงเทียบได้แค่ "มูลค่าตามบัญชี vs ราคาประเมิน"
    // ในแถวเดียวกัน — หัวข้อจึงต้องบอกตามที่เทียบจริง ไม่ใช่บอกว่า "มูลค่าลดลง"
    if (appraisal > 0 && value > 0 && value < appraisal * 0.9) {
      items.push({
        key: `col-gap:${e.rowKey}`,
        kind: 'หลักประกัน — มูลค่าตามบัญชีต่ำกว่าราคาประเมิน',
        ref: e.ref,
        dueDate: f.appr_date ?? localISO(today),
        days: 0,
        severity: 'soon',
        route: e.route,
        category: 'collateral',
        menuKey: e.menuKey,
        note: `มูลค่าตามบัญชี ${value.toLocaleString()} ต่ำกว่าราคาประเมิน ${appraisal.toLocaleString()} เกิน 10% — กระทบสัดส่วนหลักประกันต่อวงเงิน`,
      });
    }
  }

  return { items, errors };
}

// =====================================================================
// 3) ปลดหลักประกันรถ — สัญญาชำระครบ/ปิดแล้วแต่ยังผูกรถอยู่
// =====================================================================
async function getReleaseNotifications(): Promise<NotiPart> {
  const items: NotiItem[] = [];
  const errors: string[] = [];
  const t = startOfToday();
  const today = localISO(t);

  const chassisNote = (label: string, count: number, nos: string[]) => {
    const head = nos.slice(0, 5).join(', ');
    const more = nos.length > 5 ? `, +${nos.length - 5}` : '';
    return `${label} — ปลดได้ ${count} คัน · ${nos.length ? head + more : '—'}`;
  };

  // P/N — เลขตัวถังเก็บเป็นข้อมูลในตัวสัญญาเอง
  const { data: pns, error: pnErr } = await supabase
    .from('promissory_notes')
    .select('id, name, pn_number, chassis_list')
    .eq('status', 'Repaid');
  if (pnErr) errors.push(`ดึงข้อมูล P/N ที่ชำระครบไม่สำเร็จ (${pnErr.message})`);
  for (const r of (pns ?? []) as any[]) {
    const chassis = Array.isArray(r.chassis_list) ? r.chassis_list : [];
    if (chassis.length === 0) continue;
    const nos = chassis.map((c: any) => c?.chassis_no).filter(Boolean);
    items.push({
      key: `release:pn:${r.id}`,
      kind: 'ปลดหลักประกันรถ — P/N',
      ref: r.pn_number ?? r.name ?? r.id,
      dueDate: today,
      days: 0,
      severity: 'soon',
      route: `/tx/pn/${r.id}`,
      category: 'release',
      menuKey: 'pn',
      note: chassisNote('P/N ชำระครบ', chassis.length, nos),
    });
  }

  // Floor Plan — ดึงเลขตัวถังของทุกสัญญาในคำสั่งเดียว (เดิมยิงทีละสัญญาในลูป)
  const { data: fps, error: fpErr } = await supabase
    .from('floor_plans')
    .select('id, fp_no, name, status')
    .in('status', ['Repaid', 'Closed']);
  if (fpErr) errors.push(`ดึงข้อมูล Floor Plan ที่ปิดแล้วไม่สำเร็จ (${fpErr.message})`);
  const fpRows = (fps ?? []) as any[];
  if (fpRows.length) {
    const { data: ch, error: chErr } = await supabase
      .from('fp_chassis')
      .select('fp_id, chassis_no')
      .in('fp_id', fpRows.map((r) => r.id));
    if (chErr) errors.push(`ดึงข้อมูลรถของ Floor Plan ไม่สำเร็จ (${chErr.message})`);
    const byFp = new Map<string, string[]>();
    for (const c of (ch ?? []) as any[]) {
      if (!byFp.has(c.fp_id)) byFp.set(c.fp_id, []);
      if (c.chassis_no) byFp.get(c.fp_id)!.push(c.chassis_no);
    }
    for (const r of fpRows) {
      const nos = byFp.get(r.id) ?? [];
      if (nos.length === 0) continue;
      items.push({
        key: `release:fp:${r.id}`,
        kind: 'ปลดหลักประกันรถ — Floor Plan',
        ref: r.fp_no ?? r.name ?? r.id,
        dueDate: today,
        days: 0,
        severity: 'soon',
        route: `/tx/fp/${r.id}`,
        category: 'release',
        menuKey: 'fp',
        note: chassisNote('Floor Plan ปิดแล้ว', nos.length, nos),
      });
    }
  }

  // Loan — Modified = จบด้วยการแก้เงื่อนไขแล้วเปิดสัญญาใหม่แทน หลักประกันจึงต้องปลดด้วย
  const { data: loans, error: loanErr } = await supabase
    .from('loans')
    .select('id, loan_no, name, status')
    .in('status', ['Closed', 'Modified']);
  if (loanErr) errors.push(`ดึงข้อมูล Loan ที่ปิดแล้วไม่สำเร็จ (${loanErr.message})`);
  const loanRows = (loans ?? []) as any[];
  if (loanRows.length) {
    const { data: ch, error: chErr } = await supabase
      .from('loan_chassis')
      .select('loan_id, chassis_no')
      .in('loan_id', loanRows.map((r) => r.id));
    if (chErr) errors.push(`ดึงข้อมูลรถของ Loan ไม่สำเร็จ (${chErr.message})`);
    const byLoan = new Map<string, string[]>();
    for (const c of (ch ?? []) as any[]) {
      if (!byLoan.has(c.loan_id)) byLoan.set(c.loan_id, []);
      if (c.chassis_no) byLoan.get(c.loan_id)!.push(c.chassis_no);
    }
    for (const r of loanRows) {
      const nos = byLoan.get(r.id) ?? [];
      if (nos.length === 0) continue;
      items.push({
        key: `release:loan:${r.id}`,
        kind: 'ปลดหลักประกันรถ — Loan',
        ref: r.loan_no ?? r.name ?? r.id,
        dueDate: today,
        days: 0,
        severity: 'soon',
        route: `/tx/loan/${r.id}`,
        category: 'release',
        menuKey: 'loan',
        note: chassisNote('Loan ปิดแล้ว', nos.length, nos),
      });
    }
  }

  return { items, errors };
}

// =====================================================================
// 4) ถึงรอบชำระคืนบางส่วนของ Floor Plan (Curtailment)
// =====================================================================
async function getCurtailmentNotifications(windowDays: number): Promise<NotiPart> {
  const today = startOfToday();
  const todayMs = today.getTime();
  const items: NotiItem[] = [];
  const errors: string[] = [];

  const { data: fps, error: fpErr } = await supabase
    .from('floor_plans')
    .select('id, fp_no, name, vendor, transaction_date, total_amount, amount, used_amount, schedule_mode, status')
    .eq('schedule_mode', 'bmw')
    .not('status', 'in', '("Closed","Repaid","Cancelled","Roll Over")')
    .not('transaction_date', 'is', null)
    .not('vendor', 'is', null);
  if (fpErr) return { items, errors: [`ดึงข้อมูล Floor Plan ไม่สำเร็จ (${fpErr.message})`] };
  if (!fps || fps.length === 0) return { items, errors };

  const { data: cms, error: cmErr } = await supabase
    .from('curtailments')
    .select('*')
    .eq('status', 'Active');
  if (cmErr) return { items, errors: [`ดึงข้อมูลเงื่อนไขการชำระคืนบางส่วนไม่สำเร็จ (${cmErr.message})`] };

  const fpIds = (fps as any[]).map((f) => f.id);

  // งวดที่ชำระหรือลงบัญชีไปแล้วต้องไม่เตือนอีก — เดิมเตือนซ้ำไปตลอดกาล
  // เทียบ 2 ทาง: ธงในตารางงวดกลาง และใบสำคัญชนิดชำระคืนบางส่วนที่ลงบัญชีแล้ว
  const { data: ftRows } = await supabase.from('facility_types').select('id, code');
  const fpTypeId = ((ftRows ?? []) as any[]).find((f) => f.code === 'FP')?.id ?? null;

  const settledByDate = new Map<string, { period: number; done: boolean }>();
  if (fpTypeId) {
    const { data: sched, error: schErr } = await supabase
      .from('installment_schedules')
      .select('facility_id, period, due_date, curtail_pct, paid, je_posted')
      .eq('facility_type_id', fpTypeId)
      .in('facility_id', fpIds);
    if (schErr) errors.push(`ดึงตารางงวดของ Floor Plan ไม่สำเร็จ (${schErr.message})`);
    for (const s of (sched ?? []) as any[]) {
      if (!(Number(s.curtail_pct ?? 0) > 0)) continue;
      settledByDate.set(`${s.facility_id}|${s.due_date}`, {
        period: s.period,
        done: !!s.paid || !!s.je_posted,
      });
    }
  }

  const { data: curtailJE, error: jeErr } = await supabase
    .from('journal_entries')
    .select('source_id, source_period')
    .eq('source_type', 'FP_CURTAIL')
    .eq('status', 'Posted')
    .in('source_id', fpIds);
  if (jeErr) errors.push(`ดึงใบสำคัญการชำระคืนบางส่วนไม่สำเร็จ (${jeErr.message})`);
  const postedCurtail = new Set(((curtailJE ?? []) as any[]).map((r) => `${r.source_id}:${r.source_period}`));

  for (const fp of fps as any[]) {
    const txDate = fp.transaction_date as string;
    if (!txDate) continue;

    // จับคู่ด้วยชื่อผู้จำหน่าย — ต้องไม่สนตัวพิมพ์ใหญ่เล็กและช่องว่างหัวท้าย
    // ให้เหมือนกับที่หน้าสัญญาทำ ไม่งั้นบนจอหาเจอแต่แจ้งเตือนเงียบสนิท
    const vendorKey = String(fp.vendor ?? '').trim().toLowerCase();
    const match = ((cms ?? []) as any[]).find((c) => {
      if (!vendorKey || String(c.vendor ?? '').trim().toLowerCase() !== vendorKey) return false;
      if (txDate < c.effective_start_date) return false;
      if (c.effective_end_date && txDate > c.effective_end_date) return false;
      return true;
    });
    if (!match) continue;

    const milestones: { tier: number; day: number; pct: number }[] = [];
    for (let t = 1; t <= 6; t++) {
      const d = match[`tier${t}_days`];
      const p = match[`tier${t}_pct`];
      if (d != null && p != null) milestones.push({ tier: t, day: d, pct: p });
    }
    if (milestones.length === 0) continue;
    milestones.sort((a, b) => a.day - b.day);

    // ยอดลดต้นคิดจากยอดเบิกจริง ให้ตรงกับตารางบนหน้าสัญญา ไม่ใช่เพดานวงเงิน
    const baseAmount = Number(fp.used_amount ?? 0) || Number(fp.total_amount ?? fp.amount ?? 0);
    const txMs = new Date(txDate).setHours(0, 0, 0, 0);
    const ref = fp.fp_no || fp.name || String(fp.id).slice(0, 8);

    for (const m of milestones) {
      const dueMs = txMs + m.day * DAY;
      const days = Math.round((dueMs - todayMs) / DAY);
      if (days > windowDays) continue;
      const dueISO = localISO(new Date(dueMs));

      const sched = settledByDate.get(`${fp.id}|${dueISO}`);
      if (sched?.done) continue;
      if (sched && postedCurtail.has(`${fp.id}:${sched.period}`)) continue;

      const requiredAmt = (baseAmount * m.pct) / 100;
      const amountText = requiredAmt.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const note =
        days < 0
          ? `รอบที่ ${m.tier} เกินกำหนด ${Math.abs(days)} วัน — ต้องชำระ ${m.pct}% (${amountText} บาท)`
          : days === 0
            ? `รอบที่ ${m.tier} ครบกำหนดวันนี้ — ต้องชำระ ${m.pct}% (${amountText} บาท)`
            : `รอบที่ ${m.tier} ครบกำหนดในอีก ${days} วัน — ต้องชำระ ${m.pct}% (${amountText} บาท)`;
      items.push({
        key: `curtailment:${fp.id}:t${m.tier}`,
        kind: 'ถึงรอบชำระคืนบางส่วน',
        ref,
        dueDate: dueISO,
        days,
        severity: bySeverity(days),
        route: `/tx/fp/${fp.id}`,
        category: 'curtailment',
        menuKey: 'fp',
        note,
      });
    }
  }
  items.sort((a, b) => a.days - b.days);
  return { items, errors };
}

// =====================================================================
// 5) รอลงบัญชีรายงวด — งวดที่ครบกำหนดแล้วแต่ยังไม่มีใบสำคัญ
// =====================================================================
/** โมดูลที่อ่านงวดจากตารางงวดกลาง (คอลัมน์คือ facility_type_id และ period) */
interface PeriodicSrc {
  code: string; // รหัสประเภทวงเงินในตารางกลาง
  table: string;
  cols: string; // คอลัมน์ของสัญญาที่ต้องใช้
  refCols: string[];
  sourceType: string; // ชนิดใบสำคัญที่ถือว่า "ลงบัญชีงวดนี้แล้ว"
  amountCol: 'interest' | 'payment';
  kind: string;
  open: string[];
  route: (r: any) => string;
  menu: string | ((r: any) => string);
}

const PERIODIC_SOURCES: PeriodicSrc[] = [
  { code: 'PN', table: 'promissory_notes', cols: 'id, pn_number, name, status', refCols: ['pn_number', 'name'], sourceType: 'PN_ACCRUED', amountCol: 'interest', kind: 'P/N — รอลงบัญชีดอกเบี้ยค้างจ่าย', open: ['Active', 'Approved'], route: (r) => `/tx/pn/${r.id}`, menu: 'pn' },
  { code: 'FP', table: 'floor_plans', cols: 'id, fp_no, name, status', refCols: ['fp_no', 'name'], sourceType: 'FP_ACCRUED', amountCol: 'interest', kind: 'Floor Plan — รอลงบัญชีดอกเบี้ยค้างจ่าย', open: ['Active', 'Approved'], route: (r) => `/tx/fp/${r.id}`, menu: 'fp' },
  { code: 'TR', table: 'trust_receipts', cols: 'id, tr_no, name, status', refCols: ['tr_no', 'name'], sourceType: 'TR_ACCRUED', amountCol: 'interest', kind: 'T/R — รอลงบัญชีดอกเบี้ยค้างจ่าย', open: ['Active', 'Approved'], route: (r) => `/tx/tr/${r.id}`, menu: 'tr' },
  { code: 'LEASE', table: 'leases', cols: 'id, lease_no, mode, status', refCols: ['lease_no'], sourceType: 'LEASE_PAY', amountCol: 'payment', kind: 'สัญญาเช่า — รอลงบัญชีค่างวด', open: ['Active', 'Approved'], route: (r) => leaseRoute(r.mode, r.id), menu: (r) => LEASE_MENU_KEY[r.mode as LeaseMode] ?? 'lease_hp' },
];

/** ข้อความจำนวนวันต้องไปทางเดียวกับป้ายความเร่งด่วน — งวดที่เลยกำหนดแล้วคือ "เกินกำหนด" */
function periodicNote(period: number, days: number): string {
  if (days < 0) return `งวด ${period} · ค้างลงบัญชี ${Math.abs(days)} วัน · กดลงบัญชี`;
  return `งวด ${period} · ครบกำหนดวันนี้ · กดลงบัญชี`;
}
const periodicSeverity = (days: number): NotiSeverity => (days < 0 ? 'overdue' : 'soon');

const PERIODIC_LIMIT = 50;

async function getPendingPeriodicJENotifications(): Promise<NotiPart> {
  const today = startOfToday();
  const todayISO = localISO(today);
  const items: NotiItem[] = [];
  const errors: string[] = [];

  // ── เงินกู้ยืม — มีตารางงวดของตัวเองอยู่แล้ว ──
  const { data: loanSch, error: loanSchErr } = await supabase
    .from('loan_schedules')
    .select('loan_id, period, due_date, loans!inner(loan_no, status)')
    .lte('due_date', todayISO)
    .in('loans.status', ['Active', 'Approved'])
    .limit(500);
  if (loanSchErr) errors.push(`ดึงตารางงวดของ Loan ไม่สำเร็จ (${loanSchErr.message})`);
  const { data: loanJE, error: loanJeErr } = await supabase
    .from('journal_entries')
    .select('source_id, source_period')
    .eq('source_type', 'LOAN_ACCRUED')
    .eq('status', 'Posted');
  if (loanJeErr) errors.push(`ดึงใบสำคัญดอกเบี้ยของ Loan ไม่สำเร็จ (${loanJeErr.message})`);
  const loanPosted = new Set(((loanJE ?? []) as any[]).map((r) => `${r.source_id}:${r.source_period}`));
  for (const s of (loanSch ?? []) as any[]) {
    if (loanPosted.has(`${s.loan_id}:${s.period}`)) continue;
    const days = daysUntil(s.due_date, today);
    items.push({
      key: `je-pending:loan:${s.loan_id}:${s.period}`,
      kind: 'Loan — รอลงบัญชีดอกเบี้ยค้างจ่าย',
      ref: s.loans?.loan_no || s.loan_id,
      dueDate: s.due_date,
      days,
      severity: periodicSeverity(days),
      route: `/tx/loan/${s.loan_id}`,
      category: 'periodic_je',
      menuKey: 'loan',
      note: periodicNote(s.period, days),
    });
  }

  // ── โมดูลที่เก็บงวดไว้ในตารางงวดกลาง ──
  // ประเภทวงเงินในตารางกลางเก็บเป็นรหัสอ้างอิง ไม่ใช่ตัวอักษร — ต้องแปลงก่อน
  const { data: ftRows, error: ftErr } = await supabase.from('facility_types').select('id, code');
  if (ftErr) errors.push(`ดึงประเภทวงเงินไม่สำเร็จ (${ftErr.message})`);
  const ftByCode = new Map(((ftRows ?? []) as any[]).map((r) => [r.code, r.id]));

  for (const src of PERIODIC_SOURCES) {
    const ftId = ftByCode.get(src.code);
    if (!ftId) continue;
    const { data: sch, error: schErr } = await supabase
      .from('installment_schedules')
      .select(`facility_id, period, due_date, ${src.amountCol}`)
      .eq('facility_type_id', ftId)
      .lte('due_date', todayISO)
      .order('due_date', { ascending: true })
      .limit(500);
    if (schErr) {
      errors.push(`ดึงตารางงวดของ ${src.kind} ไม่สำเร็จ (${schErr.message})`);
      continue;
    }
    const rows = ((sch ?? []) as any[]).filter((s) => Math.abs(Number(s[src.amountCol] ?? 0)) > 0.005);
    if (rows.length === 0) continue;

    const ids = [...new Set(rows.map((s) => s.facility_id))];
    const { data: facs, error: facErr } = await supabase.from(src.table).select(src.cols).in('id', ids);
    if (facErr) {
      errors.push(`ดึงข้อมูลสัญญาของ ${src.kind} ไม่สำเร็จ (${facErr.message})`);
      continue;
    }
    const openFac = new Map(
      ((facs ?? []) as any[]).filter((r) => src.open.includes(String(r.status))).map((r) => [r.id, r]),
    );
    if (openFac.size === 0) continue;

    const { data: je, error: jeErr } = await supabase
      .from('journal_entries')
      .select('source_id, source_period')
      .eq('source_type', src.sourceType)
      .eq('status', 'Posted')
      .in('source_id', ids);
    if (jeErr) errors.push(`ดึงใบสำคัญของ ${src.kind} ไม่สำเร็จ (${jeErr.message})`);
    const posted = new Set(((je ?? []) as any[]).map((r) => `${r.source_id}:${r.source_period}`));

    for (const s of rows) {
      const fac = openFac.get(s.facility_id);
      if (!fac) continue;
      if (posted.has(`${s.facility_id}:${s.period}`)) continue;
      const days = daysUntil(s.due_date, today);
      const ref = src.refCols.map((c) => fac[c]).find((v) => v) ?? String(s.facility_id).slice(0, 8);
      items.push({
        key: `je-pending:${src.code.toLowerCase()}:${s.facility_id}:${s.period}`,
        kind: src.kind,
        ref,
        dueDate: s.due_date,
        days,
        severity: periodicSeverity(days),
        route: src.route(fac),
        category: 'periodic_je',
        menuKey: typeof src.menu === 'function' ? src.menu(fac) : src.menu,
        note: periodicNote(s.period, days),
      });
    }
  }

  items.sort((a, b) => a.days - b.days);
  // ตัดเหลือเฉพาะที่เร่งด่วนที่สุด แล้วบอกจำนวนที่เหลือให้ผู้ใช้รู้
  const truncated = Math.max(0, items.length - PERIODIC_LIMIT);
  return { items: items.slice(0, PERIODIC_LIMIT), errors, truncated };
}

// =====================================================================
// 6) รถใน Floor Plan ถูกขายแล้วแต่ยังไม่ปิดสัญญา
// =====================================================================
async function getChassisSoldNotifications(): Promise<NotiPart> {
  const items: NotiItem[] = [];
  const errors: string[] = [];
  const today = startOfToday();

  const { data: sold, error } = await supabase
    .from('fp_chassis')
    .select('id, fp_id, chassis_no, sold_date, amount')
    .not('sold_date', 'is', null);
  if (error) return { items, errors: [`ดึงข้อมูลรถที่ขายแล้วไม่สำเร็จ (${error.message})`] };
  const rows = (sold ?? []) as any[];
  if (rows.length === 0) return { items, errors };

  const fpIds = [...new Set(rows.map((r) => r.fp_id))];
  const { data: fps, error: fpErr } = await supabase
    .from('floor_plans')
    .select('id, fp_no, name, status')
    .in('id', fpIds)
    .not('status', 'in', '("Repaid","Closed","Cancelled")');
  if (fpErr) errors.push(`ดึงข้อมูล Floor Plan ไม่สำเร็จ (${fpErr.message})`);
  const openFp = new Map(((fps ?? []) as any[]).map((f) => [f.id, f]));

  // รวมเป็นแถวเดียวต่อสัญญา — เดิมขึ้นทีละคัน ทำให้สัญญาเดียวกินพื้นที่ทั้งกล่อง
  interface Group { count: number; nos: string[]; amount: number; oldest: string; latest: string }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (!openFp.has(r.fp_id)) continue; // สัญญาปิดแล้ว — ไม่ต้องเตือน
    const g: Group = groups.get(r.fp_id)
      ?? { count: 0, nos: [], amount: 0, oldest: r.sold_date, latest: r.sold_date };
    g.count += 1;
    if (r.chassis_no) g.nos.push(r.chassis_no);
    g.amount += Number(r.amount ?? 0);
    if (r.sold_date < g.oldest) g.oldest = r.sold_date;
    if (r.sold_date > g.latest) g.latest = r.sold_date;
    groups.set(r.fp_id, g);
  }

  for (const [fpId, g] of groups) {
    const fp = openFp.get(fpId);
    // จำนวนวันนับจากการขายคันล่าสุด (ติดลบ = ขายไปแล้วกี่วัน)
    const days = daysUntil(g.latest, today);
    // ความเร่งด่วนคิดจากคันที่ค้างนานที่สุด ไม่ใช่ตั้งเป็นสีแดงตายตัว
    const oldestAge = -daysUntil(g.oldest, today);
    const severity: NotiSeverity = oldestAge >= 30 ? 'overdue' : oldestAge >= 7 ? 'soon' : 'upcoming';
    const head = g.nos.slice(0, 5).join(', ');
    const more = g.nos.length > 5 ? `, +${g.nos.length - 5}` : '';
    items.push({
      key: `fpsold:${fpId}`,
      kind: 'รถขายแล้ว — ต้องปิดสัญญาและจ่ายคืนธนาคาร',
      ref: fp.fp_no ?? fp.name ?? fpId,
      dueDate: g.latest,
      days,
      severity,
      route: `/tx/fp/${fpId}`,
      category: 'chassis_sold',
      menuKey: 'fp',
      note: `ขายแล้ว ${g.count} คัน · ค้างนานสุด ${Math.max(0, oldestAge)} วัน · ยอดเบิกคงค้างรวม ${g.amount.toLocaleString()} บาท${g.nos.length ? ` · ${head}${more}` : ''}`,
    });
  }

  // เรื่องที่เพิ่งเกิดอยู่บนสุด — รายการที่ขายไปนานมากจะไม่เกาะหัวกล่องอีก
  items.sort((a, b) => b.days - a.days);
  return { items, errors };
}

// =====================================================================
// 7) รายการรออนุมัติ
// =====================================================================
const APPROVAL_TARGETS: Array<{ table: string; nameCol: string; label: string; route: string; menu: string | ((r: any) => string) }> = [
  { table: 'master_agreements', nameCol: 'ma_name', label: 'Master Agreement', route: '/ma', menu: 'ma' },
  { table: 'credit_agreements', nameCol: 'ca_name', label: 'Credit Agreement', route: '/ca', menu: 'ca' },
  { table: 'promissory_notes', nameCol: 'pn_number', label: 'P/N', route: '/tx/pn', menu: 'pn' },
  { table: 'letter_guarantees', nameCol: 'lg_no', label: 'LG/BG', route: '/tx/lg', menu: 'lg' },
  { table: 'letters_of_credit', nameCol: 'lc_no', label: 'L/C', route: '/tx/lc', menu: 'lc' },
  { table: 'floor_plans', nameCol: 'fp_no', label: 'Floor Plan', route: '/tx/fp', menu: 'fp' },
  { table: 'overdrafts', nameCol: 'od_no', label: 'O/D', route: '/tx/od', menu: 'od' },
  { table: 'trust_receipts', nameCol: 'tr_no', label: 'T/R', route: '/tx/tr', menu: 'tr' },
  { table: 'fx_forwards', nameCol: 'fxf_no', label: 'FX Forward', route: '/tx/fxf', menu: 'fxf' },
  { table: 'loans', nameCol: 'loan_no', label: 'Loan', route: '/tx/loan', menu: 'loan' },
  // สัญญาเช่าใช้ตารางเดียวกัน 3 ชนิด — เส้นทางและรหัสเมนูคิดจาก mode รายแถว
  { table: 'leases', nameCol: 'lease_no', label: 'สัญญาเช่า', route: '', menu: (r) => LEASE_MENU_KEY[r.mode as LeaseMode] ?? 'lease_hp' },
];

async function getPendingApprovalNotifications(): Promise<NotiPart> {
  const items: NotiItem[] = [];
  const errors: string[] = [];
  // ใช้วันที่ตามเครื่อง ไม่ใช่เวลามาตรฐานสากล ไม่งั้นเปิดเว็บช่วงเช้ามืดจะได้วันที่ผิด
  const today = localISO();

  for (const t of APPROVAL_TARGETS) {
    const cols = t.table === 'leases' ? `id, ${t.nameCol}, mode` : `id, ${t.nameCol}`;
    const { data, error } = await supabase.from(t.table).select(cols).eq('status', 'Pending Approval');
    if (error) {
      errors.push(`ดึงรายการรออนุมัติของ ${t.label} ไม่สำเร็จ (${error.message})`);
      continue;
    }
    for (const r of (data ?? []) as any[]) {
      items.push({
        key: `approval-${t.table}-${r.id}`,
        kind: t.label,
        ref: r[t.nameCol] ?? '',
        dueDate: today,
        days: 0,
        severity: 'soon',
        route: t.table === 'leases' ? leaseRoute(r.mode, r.id) : `${t.route}/${r.id}`,
        category: 'approval',
        menuKey: typeof t.menu === 'function' ? t.menu(r) : t.menu,
        note: 'รอการอนุมัติ — เปิดรายการเพื่ออนุมัติหรือส่งกลับแก้ไข',
      });
    }
  }
  return { items, errors };
}

// =====================================================================
// รวมทุกหมวด
// =====================================================================
export interface GetAllOptions {
  windowDays?: number;
  /** รหัสเมนูที่ผู้ใช้มีสิทธิ์ดู — ไม่ส่ง = ไม่กรอง (เช่นตอนเรียกจากงานเบื้องหลัง) */
  allowedMenus?: readonly string[] | null;
}

export async function getAllNotifications(opts: GetAllOptions = {}): Promise<NotiResult> {
  const windowDays = opts.windowDays ?? 30;
  const parts = await Promise.all([
    getPendingApprovalNotifications(),
    getPendingPeriodicJENotifications(),
    getCurtailmentNotifications(windowDays),
    getChassisSoldNotifications(),
    getReleaseNotifications(),
    getMaturityNotifications(windowDays),
    getCollateralNotifications(windowDays),
  ]);

  const allow = opts.allowedMenus ? new Set(opts.allowedMenus) : null;
  const items: NotiItem[] = [];
  const errors: string[] = [];
  let truncated = 0;
  for (const p of parts) {
    errors.push(...p.errors);
    truncated += p.truncated ?? 0;
    for (const i of p.items) {
      // ไม่มีสิทธิ์ดูโมดูลไหน ก็ไม่ควรเห็นการแจ้งเตือนของโมดูลนั้น
      if (allow && i.menuKey && !allow.has(i.menuKey)) continue;
      items.push(i);
    }
  }
  items.sort((x, y) => x.days - y.days);
  return { items, errors, truncated };
}
