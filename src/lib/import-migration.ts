// Data Migration Import — parse + validate + import template xlsx (5 sheets)
// Sheet layout: row1 title · row2 legend · row3 headers (suffix " *" = required) · row4 descriptions · row5+ data
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { SUBSIDIARY_CODES_FALLBACK } from './subsidiaries';

// รหัสวิธีผ่อน (Payment Type) → ข้อความเต็มตาม dropdown ระบบ — กัน user พิมพ์ข้อความยาวผิด
// ค่า payment type มาตรฐาน (ตรงกับ dropdown ของแอป cr — เก็บเป็น label เต็ม)
// map: ค่าที่กรอก → ค่าที่บันทึกลง DB · label ใหม่ map เป็นตัวเอง · โค้ดเก่า (FI/FP…) map ขึ้น label ใหม่เพื่อ backward compat
export const PT_CODE: Record<string, string> = {
  'Fix installment': 'Fix installment',
  'Step installment': 'Step installment',
  'Fix installment with Balloon': 'Fix installment with Balloon',
  'Step installment with Balloon': 'Step installment with Balloon',
  'Fix Principle': 'Fix Principle',
  'Step Principle': 'Step Principle',
  'Fix Principle with Balloon': 'Fix Principle with Balloon',
  'Step Principle with Balloon': 'Step Principle with Balloon',
  // รองรับไฟล์เก่าที่ยังใช้รหัสสั้น
  'FI': 'Fix installment',
  'FI-B': 'Fix installment with Balloon',
  'FP': 'Fix Principle',
  'FP-B': 'Fix Principle with Balloon',
};

// ชื่อเต็ม/รูปแบบเก่า → ชื่อย่อ (code) ตาม Subsidiary Master
const SUB_LEGACY: Record<string, string> = {
  'Millennium Group Corporation (Asia) Plc.': 'MGC',
  'MGC Asia Public Co., Ltd.': 'MGC',
  'Millennium Cars (MCR)': 'MCR',
  'Millennium Auto Group (MAG)': 'MAG',
  'MGC Leasing Co., Ltd.': 'MAG',
  'I-24': 'i24',
};

// ───────────────────────────────────────────────────────────── types

export interface ImportError {
  sheet: string;
  row: number; // Excel row number (1-based)
  column: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedRow {
  __row: number; // Excel row number
  [key: string]: any;
}

export interface ParsedWorkbook {
  contract: ParsedRow[];
  interest: ParsedRow[];
  schedule: ParsedRow[];
  collateral: ParsedRow[];
  guarantor: ParsedRow[];
  chassis: ParsedRow[]; // Sheet 06 — รถรายคันของ FP/PN/Loan (optional)
  maSubs: ParsedRow[]; // 01_MA rows — MA + sub-allocation (1 แถว/subsidiary)
  caRaw: ParsedRow[]; // 02_CA rows (สำหรับสร้าง CA โดยตรง — import เฉพาะ CA ได้)
  sheetsFound: string[];
  sheetsMissing: string[];
}

export interface ImportSummary {
  ma: { created: number; existing: number; names: string[] };
  ca: { created: number; existing: number };
  tx: Record<string, number>; // module → created count
  rates: number;
  steps: number;
  collaterals: number;
  guarantors: number;
  chassis: number;
  errors: ImportError[];
}

export const MODULES = [
  'PN', 'LG', 'BG', 'SBLC', 'LC', 'FP', 'OD', 'TR', 'FXF',
  'Loan', 'Hire Purchase', 'Leasing', 'Leasing Other',
] as const;

const SHEETS = {
  contract: '01_Contract (MA-CA-TX)',
  interest: '02_Interest Rate',
  schedule: '03_Repayment Terms',
  collateral: '04_Collateral',
  guarantor: '05_Guarantor',
  chassis: '06_Chassis',
};

// ───────────────────────────────────────────────────────────── parse

function normHeader(h: any): string {
  return String(h ?? '').replace(/\s*\*+\s*$/, '').trim();
}

function toDateStr(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy
  if (dm) return `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  if (typeof v === 'number' && v > 25569 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  return s; // let validation flag it
}

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const isBlank = (v: any) => v == null || String(v).trim() === '';

// หัวคอลัมน์ในเทมเพลตใช้ "ชื่อตาม label หน้าจอ" (คนกรอกไม่งง) → map กลับเป็นชื่อ field ที่ logic ภายในใช้
// แยกต่อชีท เพราะ FINANCE INSTITUTION / STATUS / START DATE ฯลฯ มีซ้ำทั้ง MA / CA / TX
const MA_ALIAS: Record<string, string> = {
  'MASTER AGREEMENT NAME': 'MA_MASTER AGREEMENT NAME',
  'FINANCE INSTITUTION': 'MA_FINANCE INSTITUTION',
  'MAIN': 'MA_SUBSIDIARY',           // ฟอร์ม MA: MAIN = บริษัทเจ้าของ (ไม่ใช่ SUBSIDIARY ซึ่งเป็นบริษัทลูกที่แตกวงเงิน)
  'STATUS': 'MA_STATUS',
  'START DATE': 'MA_START DATE',
  'END DATE': 'MA_END DATE',
  'CREDIT LINE': 'MA_CREDIT LINE',
};
// ชีท 02_CA — label หน้าจอ Credit Agreement → field ภายใน
const CA_ALIAS: Record<string, string> = {
  'FINANCE INSTITUTION': 'CA_FINANCE INSTITUTION',
  'CREDIT AGREEMENT NAME': 'CA_CREDIT AGREEMENT NAME',
  'CONTRACT NUMBER': 'CA_CONTRACT NUMBER',
  'MASTER AGREEMENT': 'CA_MASTER AGREEMENT',
  'FACILITY TYPE': 'CA_FACILITY TYPE',
  'CREDIT TYPE': 'CA_CREDIT TYPE',
  'SUBSIDIARY': 'CA_SUBSIDIARY',
  'AGREEMENT STATUS': 'CA_AGREEMENT STATUS',
  'START DATE': 'CA_START DATE',
  'END DATE': 'CA_END DATE',
  'ROLL OVER CONDITION MAXIMUM TERM (DAYS)': 'CA_ROLL OVER CONDITION MAXIMUM TERM (DAYS)',
  'MAXIMUM ROLL OVER (TIMES)': 'CA_MAXIMUM ROLL OVER (TIMES)',
  'CURRENCY': 'CA_CURRENCY',
  'CREDIT LINE': 'CA_CREDIT LINE',
  'UTILIZATION': 'CA_UTILIZATION',
  'LOAN PURPOSE': 'CA_LOAN PURPOSE',
  'REFERENCE CONTRACT': 'CA_REFERENCE CONTRACT',
  'CREDIT LINE (Foreign)': 'CA_CREDIT LINE (Foreign)',
  'FX RATE': 'CA_FX RATE',
  'FX RATE DATE': 'CA_FX RATE DATE',
  'CONVERSION DATE': 'CA_CONVERSION DATE',
  'CONVERSION RATE': 'CA_CONVERSION RATE',
};
function parseSheet(ws: XLSX.WorkSheet, alias: Record<string, string> = {}, autoPrefix?: string): ParsedRow[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (rows.length < 2) return [];
  // หาแถวหัวตารางเอง (ไม่ตรึงว่าต้องอยู่แถว 3) — ทนไฟล์ที่ถูก flatten/ตัด title ออกตอน save ผ่าน Excel/Google
  // แถวหัว = แถวแรก (ใน 8 แถวแรก) ที่มี cell ไม่ว่าง ≥ 3 ช่อง (title/legend เป็น merged cell เดียว จะไม่เข้าเงื่อนไข)
  let hr = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if ((rows[i] ?? []).filter((c) => !isBlank(c)).length >= 3) { hr = i; break; }
  }
  if (hr < 0) return [];
  const headers = (rows[hr] ?? []).map(normHeader);
  // แถวถัดจากหัว = คำอธิบาย (ถ้ามี) — ตรวจจากข้อความยาว ๆ แล้วข้าม 1 แถว ไม่งั้นเริ่มอ่านข้อมูลทันที
  const descRow = rows[hr + 1] ?? [];
  const descCells = descRow.filter((c) => !isBlank(c));
  const descAvgLen = descCells.length ? descCells.reduce((s, c) => s + String(c).length, 0) / descCells.length : 0;
  const looksDesc = descCells.length >= 3 && descAvgLen > 20;
  const dataStart = hr + (looksDesc ? 2 : 1);
  const out: ParsedRow[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => isBlank(c))) continue;
    const obj: ParsedRow = { __row: i + 1 };
    headers.forEach((h, c) => {
      if (!h) return;
      obj[h] = r[c] ?? '';
      const canon = alias[h];
      if (canon) obj[canon] = r[c] ?? '';
      // TX sheet: header เป็น label หน้าจอ (เช่น AMOUNT) → เติม prefix TX_ กลับให้ logic อ่าน
      if (autoPrefix && !/^(TX_|MA_|CA_)/.test(h)) obj[autoPrefix + h] = r[c] ?? '';
    });
    out.push(obj);
  }
  return out;
}

// ชื่อ sheet ของ template V2 (แยกต่อโมดูล)
const SHEETS_V2 = {
  ma: '01_MA', ca: '02_CA',
  tx: ['03_PN', '04_LG_BG_SBLC', '05_LC', '06_FP', '07_OD', '08_TR', '09_FXF', '10_Loan', '11_HP', '12_Leasing', '13_LSO'],
  interest: 'R_Interest Rate', schedule: 'R_Repayment', collateral: 'R_Collateral', guarantor: 'R_Guarantor',
};
const sv = (v: any) => (v == null || String(v).trim() === '' ? '' : String(v).trim());

export function parseWorkbook(buf: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(buf, { cellDates: true });
  const found: string[] = [];
  const missing: string[] = [];
  const findSheet = (name: string): string | undefined =>
    wb.SheetNames.find((n) => n === name) ?? wb.SheetNames.find((n) => n.startsWith(name.slice(0, 2)) && n.length - name.length < 6);
  const get = (name: string): ParsedRow[] => {
    const exact = wb.SheetNames.find((n) => n === name);
    const fuzzy = exact ?? wb.SheetNames.find((n) => n.startsWith(name.slice(0, 2)));
    if (!fuzzy) { missing.push(name); return []; }
    found.push(fuzzy);
    return parseSheet(wb.Sheets[fuzzy]);
  };

  // ── Template V2 (แยกต่อโมดูล) — รวม MA + CA + TX กลับเป็นโครงเดียวที่ logic เดิมใช้ ──
  const isV2 = wb.SheetNames.some((n) => n === SHEETS_V2.ma || n === '01_MA');
  if (isV2) {
    const getExact = (name: string, alias: Record<string, string> = {}, autoPrefix?: string): ParsedRow[] => {
      const n = wb.SheetNames.find((x) => x === name);
      if (n) { found.push(n); return parseSheet(wb.Sheets[n], alias, autoPrefix); }
      return [];
    };
    const maRows = getExact(SHEETS_V2.ma, MA_ALIAS);
    const caRows = getExact(SHEETS_V2.ca, CA_ALIAS);
    // alias เฉพาะชีท — เมื่อ label ในฟอร์มของโมดูลนั้นต่างจากชื่อ field มาตรฐาน
    const TX_SHEET_ALIAS: Record<string, Record<string, string>> = {
      '10_Loan': {
        'TERM START DATE': 'TX_START DATE',
        'INSTALLMENT / PAY DATE': 'TX_INSTALLMENT START DATE',
      },
      // HP/Leasing/LSO: label ฟอร์มต่างจากชื่อ field — map กลับ
      '11_HP': {
        'TERM START DATE': 'TX_START DATE',
        'INSTALLMENT / PAY DATE': 'TX_PAYMENT START DATE',
        'PRINCIPAL': 'TX_PRINCIPAL AMOUNT',
        'CHASSIS NO.': 'TX_CHASSIS NO',
        'VAT (%)': 'TX_VAT',
        'INTEREST BASIS': 'TX_INTEREST BASIS',
      },
      '12_Leasing': {
        'TERM START DATE': 'TX_START DATE',
        'INSTALLMENT / PAY DATE': 'TX_PAYMENT START DATE',
        'PRINCIPAL': 'TX_PRINCIPAL AMOUNT',
      },
      '13_LSO': {
        'TERM START DATE': 'TX_START DATE',
        'INSTALLMENT / PAY DATE': 'TX_PAYMENT START DATE',
        'PRINCIPAL': 'TX_PRINCIPAL AMOUNT',
        'LEASE TYPE (TFRS16)': 'TX_TFRS16 EXEMPTION',
      },
    };
    const txRows: ParsedRow[] = [];
    for (const s of SHEETS_V2.tx) txRows.push(...getExact(s, TX_SHEET_ALIAS[s] ?? {}, 'TX_')); // header = label หน้าจอ → เติม TX_ กลับ
    const maByName = new Map(maRows.map((r) => [sv(r['MA_MASTER AGREEMENT NAME']), r]));
    const caByName = new Map(caRows.map((r) => [sv(r['CA_CREDIT AGREEMENT NAME']), r]));
    // รวม TX เข้ากับ CA ต้นสังกัด + MA ต้นสังกัด → 1 แถว = MA + CA + TX (เหมือน template เดิม)
    const contract: ParsedRow[] = txRows.map((tx) => {
      const ca = caByName.get(sv(tx['TX_CREDIT AGREEMENT NAME'])) ?? {};
      const ma = maByName.get(sv((ca as any)['CA_MASTER AGREEMENT'])) ?? {};
      return { ...(ma as any), ...(ca as any), ...tx, __row: tx.__row } as ParsedRow;
    });
    // (MA/CA สร้างจากแถว TX ที่ merge มาแล้ว · loop dedupe ด้วยชื่อ — ทุก CA ใน migration มี TX อยู่แล้ว)
    return {
      contract,
      interest: getExact(SHEETS_V2.interest),
      schedule: (() => {
        // ชีท Step Payment — ชื่อใหม่ 'R_Step Payment' (เดิม 'R_Repayment')
        const n = wb.SheetNames.find((x) => x === 'R_Step Payment' || x === SHEETS_V2.schedule || /step.?payment/i.test(x));
        return n ? parseSheet(wb.Sheets[n]) : [];
      })(),
      collateral: getExact(SHEETS_V2.collateral),
      guarantor: getExact(SHEETS_V2.guarantor),
      chassis: (() => { const n = wb.SheetNames.find((x) => /chassis/i.test(x)); return n ? parseSheet(wb.Sheets[n]) : []; })(),
      maSubs: maRows, // ชีท 01_MA รวม sub-allocation แล้ว: 1 แถว = 1 subsidiary (MAIN/ชื่อ MA ซ้ำได้)
      caRaw: caRows,
      sheetsFound: found,
      sheetsMissing: missing,
    };
  }
  void findSheet;

  // ── Template V1 (รวม 5 sheet) — ของเดิม ──
  return {
    contract: get(SHEETS.contract),
    interest: get(SHEETS.interest),
    schedule: get(SHEETS.schedule),
    collateral: get(SHEETS.collateral),
    guarantor: get(SHEETS.guarantor),
    chassis: (() => {
      // หมายเหตุ: อย่าใช้ startsWith('06') เพราะชนกับชีทโมดูล '06_FP' — จับเฉพาะชื่อที่มีคำว่า Chassis
      const n = wb.SheetNames.find((x) => x === SHEETS.chassis || /chassis/i.test(x));
      return n ? parseSheet(wb.Sheets[n]) : [];
    })(),
    maSubs: (() => { const n = wb.SheetNames.find((x) => x === 'R_MA Subsidiary'); return n ? parseSheet(wb.Sheets[n]) : []; })(),
    caRaw: [],
    sheetsFound: found,
    sheetsMissing: missing,
  };
}

// ───────────────────────────────────────────────────────────── validate

// Sheet 01 — always required
const REQ_ALWAYS = [
  'TX_MODULE', 'TX_NUMBER',
  'MA_FINANCE INSTITUTION', 'MA_MASTER AGREEMENT NAME', 'MA_SUBSIDIARY', 'MA_STATUS',
  'MA_START DATE', 'MA_END DATE', 'MA_CREDIT LINE',
  'CA_FINANCE INSTITUTION', 'CA_CREDIT AGREEMENT NAME', 'CA_CONTRACT NUMBER',
  'CA_MASTER AGREEMENT', 'CA_FACILITY TYPE', 'CA_AGREEMENT STATUS', 'CA_CREDIT TYPE',
  'CA_SUBSIDIARY', 'CA_START DATE', 'CA_END DATE', 'CA_CURRENCY', 'CA_CREDIT LINE',
  'TX_FINANCE INSTITUTION', 'TX_CREDIT AGREEMENT NAME', 'TX_STATUS', 'TX_CURRENCY',
  'TX_TRANSACTION DATE', 'TX_AMOUNT',
  'TX_OUTSTANDING AT CUTOFF',
];

// Sheet 01 — required per module (🟡)
const REQ_BY_MODULE: Record<string, string[]> = {
  'TX_TERM (DAYS)': ['PN', 'LC', 'FP', 'TR', 'FXF'],
  'TX_BANK REFERENCE': ['PN', 'LG', 'BG', 'SBLC', 'FP', 'OD', 'TR', 'Loan'],
  'TX_BENEFICIARY': ['LG', 'BG', 'SBLC', 'LC'],
  'TX_APPLICANT': ['LC'],
  'TX_ISSUE DATE': ['LC'],
  'TX_START DATE': ['LG', 'BG', 'SBLC', 'Loan'],
  'TX_END DATE': ['LG', 'BG', 'SBLC'],
  'TX_PAYMENT CYCLE': ['LG', 'BG', 'SBLC'],
  'TX_PAYMENT DATE': ['LG', 'BG', 'SBLC'],
  'TX_FX RATE → THB': ['LC'],
  'TX_AMOUNT (FOREIGN)': ['LC'],
  'TX_SUPPLIER': ['TR'],
  'TX_CAP % (เพดานเบิกต่อรถ)': ['FP'],
  'TX_DIRECTION': ['FXF'],
  'TX_NOTIONAL AMOUNT (FOREIGN)': ['FXF'],
  'TX_FORWARD RATE': ['FXF'],
  'TX_SPOT RATE': ['FXF'],
  'TX_INSTALLMENT START DATE': ['Loan'],
  'TX_TERM (MONTHS)': ['Loan', 'Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_PAYMENT TYPE': ['Loan', 'Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_ASSET TYPE': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_ASSET NAME': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_CONTRACT NUMBER': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_CONTRACT DATE': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_LEASE CLASSIFICATION': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_PAYMENT FREQUENCY': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_PAYMENT START DATE': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_CONTRACT INTEREST RATE (%)': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_PRINCIPAL AMOUNT': ['Hire Purchase', 'Leasing', 'Leasing Other'],
  'TX_VEHICLE PRICE': ['Hire Purchase'],
  'TX_VAT (%)': ['Hire Purchase'],
  'TX_DISCOUNT RATE (%)': ['Leasing', 'Leasing Other'],
};

const NUMERIC_COLS = [
  'MA_CREDIT LINE', 'CA_CREDIT LINE', 'TX_AMOUNT', 'TX_OUTSTANDING AT CUTOFF',
  'TX_INTEREST RATE (%)', 'TX_TERM (DAYS)', 'TX_TERM (MONTHS)', 'TX_PRINCIPAL AMOUNT',
];

export function validateWorkbook(p: ParsedWorkbook, subCodes?: string[], bankCodes?: string[]): ImportError[] {
  const errs: ImportError[] = [];
  const E = (sheet: string, row: number, column: string, message: string, severity: 'error' | 'warning' = 'error') =>
    errs.push({ sheet, row, column, message, severity });

  const S1 = SHEETS.contract;
  if (p.contract.length === 0 && (p.maSubs?.length ?? 0) === 0) {
    E(S1, 0, '-', 'ไม่พบข้อมูลใน Sheet 01 (ต้องมีอย่างน้อย 1 แถว)');
    return errs;
  }
  // ไฟล์เฉพาะ MA (ไม่มี TX) — ข้ามการตรวจระดับ TX/CA, ให้ import MA ได้เลย
  if (p.contract.length === 0) return errs;

  // ---- Sheet 01
  const txKeys = new Set<string>();
  const maNames = new Set<string>();
  const caNames = new Set<string>();
  const maGroup: Record<string, { row: number; vals: Record<string, any> }> = {};
  const caGroup: Record<string, { row: number; vals: Record<string, any> }> = {};
  const MA_COLS = REQ_ALWAYS.filter((c) => c.startsWith('MA_'));
  const CA_COLS = REQ_ALWAYS.filter((c) => c.startsWith('CA_'));

  for (const r of p.contract) {
    const row = r.__row;
    const mod = String(r['TX_MODULE'] ?? '').trim();
    // Leasing Other ไม่ใช้วงเงินธนาคาร จึงไม่มี Master Agreement / Credit Agreement
    // (ชนิดสัญญาบอกเองแล้ว ไม่ต้องเดาจากช่องเลขที่อ้างอิงธนาคารเหมือนเดิม)
    const noBankLease = mod === 'Leasing Other';

    for (const c of REQ_ALWAYS) {
      if (noBankLease && (c.startsWith('MA_') || c.startsWith('CA_') || c === 'TX_FINANCE INSTITUTION' || c === 'TX_CREDIT AGREEMENT NAME')) continue;
      if (isBlank(r[c])) E(S1, row, c, 'จำเป็นต้องกรอก (🔴)');
    }
    // ขากลับ: Leasing Other ไม่ใช้สินเชื่อ → ช่อง MA_/CA_ ทุกช่องต้องว่าง (กันข้อมูลครึ่งๆ กลางๆ)
    if (noBankLease) {
      for (const c of Object.keys(r)) {
        if ((c.startsWith('MA_') || c.startsWith('CA_')) && !isBlank(r[c])) {
          E(S1, row, c, `Leasing Other ไม่ใช้วงเงินธนาคาร — ช่องนี้ต้องว่าง (พบค่า "${String(r[c]).slice(0, 30)}")`);
        }
      }
    }
    if (!isBlank(mod) && !MODULES.includes(mod as any)) {
      E(S1, row, 'TX_MODULE', `"${mod}" ไม่อยู่ใน 13 ประเภท: ${MODULES.join(' / ')}`);
    }
    // subsidiary — ใช้ชื่อย่อตาม Subsidiary Master (คำแนะนำพี่ติ๋ง 14 ส.ค.)
    const SUB_OK = subCodes?.length ? subCodes : [...SUBSIDIARY_CODES_FALLBACK];
    for (const c of ['MA_SUBSIDIARY', 'CA_SUBSIDIARY']) {
      const v = String(r[c] ?? '').trim();
      if (v && !noBankLease && !SUB_OK.includes(v)) {
        E(S1, row, c, `"${v}" ไม่ถูกต้อง — ใช้ชื่อย่อบริษัทตามผัง: ${SUB_OK.join(' / ')}`);
      }
    }
    // status enum — ต้องตรงกับค่าที่ระบบรับ
    const MA_OK = ['Draft', 'Approved', 'Rejected', 'Expired', 'Terminated'];
    const CA_OK = ['Draft', 'Approved', 'Expired', 'Closed', 'Terminated'];
    const maSt = String(r['MA_STATUS'] ?? '').trim();
    const caSt = String(r['CA_AGREEMENT STATUS'] ?? '').trim();
    if (maSt && !noBankLease && !MA_OK.includes(maSt)) E(S1, row, 'MA_STATUS', `"${maSt}" ไม่ถูกต้อง — ใช้ได้: ${MA_OK.join(' / ')} (สัญญาที่ยังใช้งาน = Approved)`);
    if (caSt && !noBankLease && !CA_OK.includes(caSt)) E(S1, row, 'CA_AGREEMENT STATUS', `"${caSt}" ไม่ถูกต้อง — ใช้ได้: ${CA_OK.join(' / ')} (สัญญาที่ยังใช้งาน = Approved)`);
    // payment type — ใช้รหัสสั้น (ยอมรับข้อความเต็มแบบเดิมด้วย)
    const pt = String(r['TX_PAYMENT TYPE'] ?? '').trim();
    if (pt && !(pt in PT_CODE) && !Object.values(PT_CODE).includes(pt)) {
      E(S1, row, 'TX_PAYMENT TYPE', `"${pt.slice(0, 30)}" ไม่ถูกต้อง — ใช้ได้: Fix installment · Step installment · Fix installment with Balloon · Step installment with Balloon · Fix Principle · Step Principle · Fix Principle with Balloon · Step Principle with Balloon`);
    }
    // interest type — ต้องตรง dropdown ระบบ
    const itx = String(r['TX_INTEREST TYPE'] ?? '').trim();
    if (itx && !['MLR', 'MOR', 'MRR', 'MMR', 'Fixed'].includes(itx)) {
      E(S1, row, 'TX_INTEREST TYPE', `"${itx}" ไม่ถูกต้อง — ใช้ได้: MLR / MOR / MRR / MMR / Fixed`);
    }
    // finance institution — เช็คชื่อย่อธนาคารกับ Vendor Master
    const BANK_OK = bankCodes?.length ? bankCodes : null;
    if (BANK_OK) {
      for (const c of ['MA_FINANCE INSTITUTION', 'CA_FINANCE INSTITUTION', 'TX_FINANCE INSTITUTION']) {
        const v = String(r[c] ?? '').trim();
        if (v && !noBankLease && !BANK_OK.includes(v)) {
          E(S1, row, c, `"${v}" ไม่อยู่ใน Bank Master — ใช้ชื่อย่อ: ${BANK_OK.join(' / ')}`);
        }
      }
    }
    // applicant (LC) — บริษัทเรา ใช้ชื่อย่อตามผังเหมือน SUBSIDIARY
    // (BANK ใน Sheet 04 เช็คแยกด้านล่าง — ใช้ Bank Master ชุดเดียวกัน)
    const app = String(r['TX_APPLICANT'] ?? '').trim();
    if (app && !SUB_OK.includes(app)) {
      E(S1, row, 'TX_APPLICANT', `"${app}" ไม่ถูกต้อง — ผู้ขอเปิด L/C คือบริษัทเรา ใช้ชื่อย่อตามผัง: ${SUB_OK.join(' / ')}`);
    }
    // duplicate TX key
    const key = `${mod}|${String(r['TX_NUMBER'] ?? '').trim()}`;
    if (!isBlank(r['TX_NUMBER'])) {
      if (txKeys.has(key)) E(S1, row, 'TX_NUMBER', `ซ้ำ: ${key.replace('|', ' ')} มีมากกว่า 1 แถว`);
      txKeys.add(key);
    }
    // module-conditional (🟡)
    for (const [c, mods] of Object.entries(REQ_BY_MODULE)) {
      if (mods.includes(mod) && c in r && isBlank(r[c])) {
        E(S1, row, c, `จำเป็นสำหรับ ${mod} (🟡)`);
      }
    }
    // CA conditional
    const cur = String(r['CA_CURRENCY'] ?? '').trim();
    if (cur && cur !== 'THB') {
      for (const c of ['CA_CREDIT LINE (Foreign)', 'CA_FX RATE', 'CA_FX RATE DATE', 'CA_CONVERSION DATE', 'CA_CONVERSION RATE']) {
        if (c in r && isBlank(r[c])) E(S1, row, c, `จำเป็นเมื่อ CA_CURRENCY = ${cur} (🟡)`);
      }
    }
    if (String(r['CA_CREDIT TYPE'] ?? '').trim() === 'Revolving') {
      for (const c of ['CA_ROLL OVER CONDITION MAXIMUM TERM (DAYS)', 'CA_MAXIMUM ROLL OVER (TIMES)']) {
        if (c in r && isBlank(r[c])) E(S1, row, c, 'จำเป็นเมื่อ CREDIT TYPE = Revolving (🟡)');
      }
    }
    // numeric
    for (const c of NUMERIC_COLS) {
      if (c in r && !isBlank(r[c]) && toNum(r[c]) == null) E(S1, row, c, `"${r[c]}" ไม่ใช่ตัวเลข`);
    }
    // MA-in-row consistency
    const maN = String(r['MA_MASTER AGREEMENT NAME'] ?? '').trim();
    const caRef = String(r['CA_MASTER AGREEMENT'] ?? '').trim();
    if (maN && caRef && maN !== caRef) {
      E(S1, row, 'CA_MASTER AGREEMENT', `"${caRef}" ไม่ตรงกับ MA_MASTER AGREEMENT NAME "${maN}" ในแถวเดียวกัน`);
    }
    // MA dedupe consistency
    if (maN) {
      maNames.add(maN);
      const vals: Record<string, any> = {};
      MA_COLS.forEach((c) => { vals[c] = String(r[c] ?? '').trim(); });
      if (!maGroup[maN]) maGroup[maN] = { row, vals };
      else {
        for (const c of MA_COLS) {
          if (maGroup[maN].vals[c] !== vals[c]) {
            E(S1, row, c, `MA "${maN}" ข้อมูลไม่ตรงกับแถว ${maGroup[maN].row} (${maGroup[maN].vals[c]} ≠ ${vals[c]}) — แถวที่อ้าง MA เดียวกันต้องพิมพ์เหมือนกันทุก column`);
          }
        }
      }
    }
    // CA dedupe consistency (by contract number)
    const caNo = String(r['CA_CONTRACT NUMBER'] ?? '').trim();
    const caName = String(r['CA_CREDIT AGREEMENT NAME'] ?? '').trim();
    if (caName) caNames.add(caName);
    if (caNo) {
      const vals: Record<string, any> = {};
      CA_COLS.forEach((c) => { vals[c] = String(r[c] ?? '').trim(); });
      if (!caGroup[caNo]) caGroup[caNo] = { row, vals };
      else {
        for (const c of CA_COLS) {
          if (caGroup[caNo].vals[c] !== vals[c]) {
            E(S1, row, c, `CA "${caNo}" ข้อมูลไม่ตรงกับแถว ${caGroup[caNo].row} — แถวที่อ้าง CA เดียวกันต้องพิมพ์เหมือนกันทุก column`);
          }
        }
      }
    }
  }

  // ---- Sheets 02 + 03 (key = TX_MODULE + TX_NUMBER)
  const childReq: Array<[string, ParsedRow[], string[]]> = [
    [SHEETS.interest, p.interest, ['TX_MODULE', 'TX_NUMBER', 'INTEREST TYPE', 'INTEREST RATE (%)', 'INTEREST START DATE']],
    [SHEETS.schedule, p.schedule, ['TX_MODULE', 'TX_NUMBER', 'STEP PERIOD', 'INSTALLMENT']],
  ];
  for (const [sheet, rows, req] of childReq) {
    for (const r of rows) {
      for (const c of req) if (c in r && isBlank(r[c])) E(sheet, r.__row, c, 'จำเป็นต้องกรอก (🔴)');
      const key = `${String(r['TX_MODULE'] ?? '').trim()}|${String(r['TX_NUMBER'] ?? '').trim()}`;
      if (!isBlank(r['TX_NUMBER']) && !txKeys.has(key)) {
        E(sheet, r.__row, 'TX_NUMBER', `${key.replace('|', ' ')} ไม่พบใน Sheet 01`);
      }
      // interest type ต้องตรง dropdown ระบบ
      if (sheet === SHEETS.interest) {
        const IT_OK = ['MLR', 'MOR', 'MRR', 'MMR', 'Fixed'];
        const it = String(r['INTEREST TYPE'] ?? '').trim();
        if (it && !IT_OK.includes(it)) E(sheet, r.__row, 'INTEREST TYPE', `"${it}" ไม่ถูกต้อง — ใช้ได้: ${IT_OK.join(' / ')}`);
      }
    }
  }

  // ---- Sheets 04 + 05 (key = MA + CA + ผูกกับระดับ)
  const parentReq: Array<[string, ParsedRow[], string[]]> = [
    [SHEETS.collateral, p.collateral, ['COLLATERAL TYPE']],
    [SHEETS.guarantor, p.guarantor, ['GUARANTOR TYPE', 'AMOUNT (บาท)']],
  ];
  for (const [sheet, rows, req] of parentReq) {
    for (const r of rows) {
      const row = r.__row;
      const maN = String(r['MA_MASTER AGREEMENT NAME'] ?? '').trim();
      const caN = String(r['CA_CREDIT AGREEMENT NAME'] ?? '').trim();
      const lvl = String(r['ผูกกับระดับ'] ?? '').trim().toUpperCase();
      if (!maN) E(sheet, row, 'MA_MASTER AGREEMENT NAME', 'จำเป็นต้องกรอก (🔴)');
      else if (!maNames.has(maN)) E(sheet, row, 'MA_MASTER AGREEMENT NAME', `"${maN}" ไม่พบใน Sheet 01`);
      if (!lvl) E(sheet, row, 'ผูกกับระดับ', 'จำเป็นต้องกรอก MA หรือ CA (🔴)');
      else if (!['MA', 'CA'].includes(lvl)) E(sheet, row, 'ผูกกับระดับ', `"${lvl}" ต้องเป็น MA หรือ CA เท่านั้น`);
      if (lvl === 'CA') {
        if (!caN) E(sheet, row, 'CA_CREDIT AGREEMENT NAME', 'จำเป็นเมื่อ ผูกกับระดับ = CA (🟡)');
        else if (!caNames.has(caN)) E(sheet, row, 'CA_CREDIT AGREEMENT NAME', `"${caN}" ไม่พบใน Sheet 01`);
      }
      for (const c of req) if (c in r && isBlank(r[c])) E(sheet, row, c, 'จำเป็นต้องกรอก (🔴)');
      // ค่า type ต้องตรงกับ dropdown ระบบ
      if (sheet === SHEETS.collateral) {
        const ct = String(r['COLLATERAL TYPE'] ?? '').trim();
        const CT_OK = ['ที่ดิน/อสังหาริมทรัพย์', 'ยานพาหนะ', 'เงินฝากธนาคาร', 'หลักประกันทางธุรกิจ', 'อื่น ๆ', 'อื่นๆ'];
        if (ct && !CT_OK.includes(ct)) E(sheet, row, 'COLLATERAL TYPE', `"${ct}" ไม่ตรง dropdown ระบบ — ใช้ได้: ${CT_OK.slice(0, 5).join(' / ')}`);
        // BANK (เงินฝากค้ำ) — เช็คชื่อย่อกับ Bank Master
        const bk = String(r['BANK'] ?? '').trim();
        if (bk && bankCodes?.length && !bankCodes.includes(bk)) {
          E(sheet, row, 'BANK', `"${bk}" ไม่อยู่ใน Bank Master — ใช้ชื่อย่อ: ${bankCodes.join(' / ')}`);
        }
      }
      if (sheet === SHEETS.guarantor) {
        const gt = String(r['GUARANTOR TYPE'] ?? '').trim();
        const GT_OK = ['บุคคลค้ำประกัน', 'นิติบุคคลค้ำประกัน'];
        if (gt && !GT_OK.includes(gt)) E(sheet, row, 'GUARANTOR TYPE', `"${gt}" ไม่ตรง dropdown ระบบ — ใช้ได้: ${GT_OK.join(' / ')}`);
      }
    }
  }

  // ---- Sheet 06 (Chassis — optional · key = TX_MODULE + TX_NUMBER + CHASSIS NO.)
  const CH_MODULES = ['FP', 'PN', 'Loan'];
  const chKeys = new Set<string>();
  for (const r of p.chassis) {
    const row = r.__row;
    const mod = String(r['TX_MODULE'] ?? '').trim();
    const txNo = String(r['TX_NUMBER'] ?? '').trim();
    const chNo = String(r['CHASSIS NO.'] ?? '').trim();
    if (!mod) E(SHEETS.chassis, row, 'TX_MODULE', 'จำเป็นต้องกรอก (🔴)');
    else if (!CH_MODULES.includes(mod)) E(SHEETS.chassis, row, 'TX_MODULE', `"${mod}" ไม่ถูกต้อง — sheet นี้ใช้กับ ${CH_MODULES.join(' / ')} เท่านั้น`);
    if (!txNo) E(SHEETS.chassis, row, 'TX_NUMBER', 'จำเป็นต้องกรอก (🔴)');
    else if (mod && CH_MODULES.includes(mod) && !txKeys.has(`${mod}|${txNo}`)) {
      E(SHEETS.chassis, row, 'TX_NUMBER', `"${txNo}" (${mod}) ไม่พบใน Sheet 01`);
    }
    if (!chNo) E(SHEETS.chassis, row, 'CHASSIS NO.', 'จำเป็นต้องกรอก (🔴)');
    if (isBlank(r['ราคารถ (COST)'])) E(SHEETS.chassis, row, 'ราคารถ (COST)', 'จำเป็นต้องกรอก (🔴)');
    else if (toNum(r['ราคารถ (COST)']) == null) E(SHEETS.chassis, row, 'ราคารถ (COST)', 'ต้องเป็นตัวเลข');
    const k = `${mod}|${txNo}|${chNo}`;
    if (chNo && chKeys.has(k)) E(SHEETS.chassis, row, 'CHASSIS NO.', `ซ้ำ: ${chNo} ของ ${txNo} มีมากกว่า 1 แถว`);
    chKeys.add(k);
  }

  return errs;
}

// ───────────────────────────────────────────────────────────── import

const D = toDateStr;
const N = toNum;
const S = (v: any) => (isBlank(v) ? null : String(v).trim());

export async function runImport(
  p: ParsedWorkbook,
  onProgress?: (msg: string) => void,
): Promise<ImportSummary> {
  const sum: ImportSummary = {
    ma: { created: 0, existing: 0, names: [] },
    ca: { created: 0, existing: 0 },
    tx: {}, rates: 0, steps: 0, collaterals: 0, guarantors: 0, chassis: 0, errors: [],
  };
  const fail = (sheet: string, row: number, column: string, e: any) =>
    sum.errors.push({ sheet, row, column, message: e?.message ?? String(e), severity: 'error' });
  const log = (m: string) => onProgress?.(m);

  // facility_types lookup
  const { data: fts } = await supabase.from('facility_types').select('id,name_en,code');
  const ftByName = new Map<string, string>();
  (fts ?? []).forEach((f: any) => {
    ftByName.set(String(f.name_en).toLowerCase(), f.id);
    if (f.code) ftByName.set(String(f.code).toLowerCase(), f.id);
  });
  // ชื่อในเทมเพลต → รหัสประเภทวงเงิน · LG กับ BG ใช้รหัสเดียวกัน · Leasing และ Leasing Other ใช้รหัส Lease
  const FT_ALIAS: Record<string, string> = {
    bg: 'lg', 'lg/bg': 'lg', leasing: 'lease', 'leasing other': 'lease',
    'hire purchase': 'hp', loan: 'loan', pn: 'pn', od: 'od', tr: 'tr', fp: 'fp',
    lc: 'lc', sblc: 'sblc', fxf: 'fxf',
  };
  const resolveFT = (name: any): string | null => {
    const k = String(name ?? '').trim().toLowerCase();
    return ftByName.get(k) ?? ftByName.get(FT_ALIAS[k] ?? '') ?? null;
  };

  // vendor (Lessor) lookup — map ชื่อ/code → vendors.id (สำหรับ Leasing Other · ฟอร์มโชว์ LESSOR เมื่อมี vendor_id)
  const { data: vends } = await supabase.from('vendors').select('id,code,name');
  const vendorByKey = new Map<string, string>();
  (vends ?? []).forEach((v: any) => {
    if (v.code) vendorByKey.set(String(v.code).trim().toLowerCase(), v.id);
    if (v.name) vendorByKey.set(String(v.name).trim().toLowerCase(), v.id);
  });
  const resolveVendorId = (v: any): string | null => vendorByKey.get(String(v ?? '').trim().toLowerCase()) ?? null;

  // subsidiary — เก็บเป็นชื่อย่อ (code) ตาม Subsidiary Master (0084) · แปลงชื่อเต็มรูปแบบเก่าให้เป็น code
  const resolveSub = (v: any): string | null => {
    const k = String(v ?? '').trim();
    if (!k) return null;
    return SUB_LEGACY[k] ?? k;
  };

  // ---- 1. MA (dedupe by ma_name)
  log('กำลังสร้าง Master Agreement...');
  // สร้าง MA จากชีท 01_MA โดยตรง (p.maSubs) — รองรับ import เฉพาะ MA ไม่มี TX ได้ · V1 ไม่มี maSubs → ใช้ contract
  const maSource = p.maSubs.length ? p.maSubs : p.contract;
  const maRows = new Map<string, ParsedRow>();
  for (const r of maSource) {
    const n = S(r['MA_MASTER AGREEMENT NAME']);
    if (n && !maRows.has(n)) maRows.set(n, r);
  }
  // วงเงินรวม MA = ผลรวมของวงเงินที่แบ่งให้แต่ละ subsidiary (01_MA อาจมีหลายแถวต่อ MA)
  const maCredit = new Map<string, number>();
  for (const r of p.maSubs) {
    const n = S(r['MA_MASTER AGREEMENT NAME']); if (!n) continue;
    maCredit.set(n, (maCredit.get(n) ?? 0) + (N(r['CREDIT LINE']) ?? 0));
  }
  const maIds = new Map<string, string>();
  {
    const names = [...maRows.keys()];
    const { data: existing } = await supabase.from('master_agreements').select('id,ma_name').in('ma_name', names);
    const existById = new Map<string, string>((existing ?? []).map((m: any) => [m.ma_name, m.id]));
    (existing ?? []).forEach((m: any) => maIds.set(m.ma_name, m.id));
    for (const [name, r] of maRows) {
      const payload = {
        finance_institution: S(r['MA_FINANCE INSTITUTION']),
        ma_name: name,
        subsidiary: resolveSub(r['MA_SUBSIDIARY']),
        status: S(r['MA_STATUS']) ?? 'Draft',
        start_date: D(r['MA_START DATE']),
        end_date: D(r['MA_END DATE']),
        credit_line: maCredit.get(name) || N(r['MA_CREDIT LINE']) || 0,
      };
      const exId = existById.get(name);
      if (exId) {
        // upsert — อัปเดต MA เดิม
        const { error } = await supabase.from('master_agreements').update(payload).eq('id', exId);
        if (error) { fail(SHEETS.contract, r.__row, 'MA_MASTER AGREEMENT NAME', error); continue; }
        sum.ma.existing++;
      } else {
        const { data, error } = await supabase.from('master_agreements').insert(payload).select('id').single();
        if (error) { fail(SHEETS.contract, r.__row, 'MA_MASTER AGREEMENT NAME', error); continue; }
        maIds.set(name, data!.id);
        sum.ma.created++;
        sum.ma.names.push(name);
      }
    }
  }

  // ---- MA sub-allocation (R_MA Subsidiary) — แบ่งวงเงินย่อยต่อบริษัท → ma_subsidiaries
  for (const r of p.maSubs) {
    const maName = S(r['MA_MASTER AGREEMENT NAME']);
    const sub = resolveSub(r['SUBSIDIARY']);
    if (!maName || !sub) continue;
    const maId = maIds.get(maName);
    if (!maId) { fail('01_MA', r.__row, 'MA_MASTER AGREEMENT NAME', `ไม่พบ MA "${maName}" ในระบบ`); continue; }
    const { data: ex } = await supabase.from('ma_subsidiaries').select('id,subsidiary').eq('ma_id', maId);
    const exRow = (ex ?? []).find((x: any) => x.subsidiary === sub);
    const payload = { ma_id: maId, subsidiary: sub, credit_line: N(r['CREDIT LINE']) ?? 0, utilization: N(r['UTILIZATION']) ?? 0 };
    const { error } = exRow
      ? await supabase.from('ma_subsidiaries').update(payload).eq('id', exRow.id)           // upsert
      : await supabase.from('ma_subsidiaries').insert({ ...payload, sort_order: (ex?.length ?? 0) });
    if (error) fail('01_MA', r.__row, 'SUBSIDIARY', error);
  }

  // rate cards per TX from sheet 02
  const ratesByTx = new Map<string, any[]>();
  for (const r of p.interest) {
    const key = `${S(r['TX_MODULE'])}|${S(r['TX_NUMBER'])}`;
    const list = ratesByTx.get(key) ?? [];
    list.push({
      type: S(r['INTEREST TYPE']) ?? 'Fixed',
      rate: N(r['INTEREST RATE (%)']) ?? 0,
      condition: N(r['INTEREST RATE CONDITION (%)']) ?? 0,
      overlimit: N(r['OVERLIMIT / CLEAN OVERDRAW (%)']) ?? undefined,
      start_date: D(r['INTEREST START DATE']),
    });
    list.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    ratesByTx.set(key, list);
  }

  // ---- 2. CA (dedupe by contract_number)
  log('กำลังสร้าง Credit Agreement...');
  // สร้าง CA จากชีท 02_CA โดยตรง (p.caRaw) — รองรับ import เฉพาะ CA · V1 ไม่มี caRaw → ใช้ contract
  const caSource = p.caRaw.length ? p.caRaw : p.contract;
  const caRows = new Map<string, ParsedRow>();
  const caTxs = new Map<string, string[]>(); // contract_number → tx keys
  for (const r of caSource) {
    const no = S(r['CA_CONTRACT NUMBER']);
    if (!no) continue;
    if (!caRows.has(no)) caRows.set(no, r);
    const key = `${S(r['TX_MODULE'])}|${S(r['TX_NUMBER'])}`;
    if (S(r['TX_MODULE'])) caTxs.set(no, [...(caTxs.get(no) ?? []), key]);
  }
  // เติม ma_id ของ MA ที่มีอยู่แล้วใน DB (กรณี import เฉพาะ CA — MA ถูกสร้างไว้รอบก่อน)
  {
    const needMa = [...caRows.values()].map((r) => S(r['CA_MASTER AGREEMENT'])).filter((n): n is string => !!n && !maIds.has(n));
    if (needMa.length) {
      const { data: exMa } = await supabase.from('master_agreements').select('id,ma_name').in('ma_name', [...new Set(needMa)]);
      (exMa ?? []).forEach((m: any) => maIds.set(m.ma_name, m.id));
    }
  }
  const caIds = new Map<string, string>();      // contract_number → id
  const caIdByName = new Map<string, string>(); // ca_name → id (for sheets 04/05)
  {
    const nos = [...caRows.keys()];
    const { data: existing } = await supabase.from('credit_agreements').select('id,contract_number,ca_name').in('contract_number', nos);
    const caExistById = new Map<string, string>((existing ?? []).map((c: any) => [c.contract_number, c.id]));
    (existing ?? []).forEach((c: any) => { caIds.set(c.contract_number, c.id); caIdByName.set(c.ca_name, c.id); });
    for (const [no, r] of caRows) {
      const maName = S(r['CA_MASTER AGREEMENT']) ?? S(r['MA_MASTER AGREEMENT NAME']);
      const rateCards = (caTxs.get(no) ?? []).flatMap((k) => ratesByTx.get(k) ?? []);
      const singleRate = N(r['TX_INTEREST RATE (%)']);
      if (rateCards.length === 0 && singleRate != null) {
        rateCards.push({ type: S(r['TX_INTEREST TYPE']) ?? 'Fixed', rate: singleRate, condition: 0, start_date: D(r['CA_START DATE']) });
      }
      const ftId = resolveFT(r['CA_FACILITY TYPE']) ?? resolveFT(r['TX_MODULE']);
      if (!ftId) {
        fail(SHEETS.contract, r.__row, 'CA_FACILITY TYPE', `"${S(r['CA_FACILITY TYPE'])}" ไม่พบใน Facility Type master`);
        continue;
      }
      const payload = {
        ma_id: maName ? maIds.get(maName) ?? null : null,
        ca_name: S(r['CA_CREDIT AGREEMENT NAME']),
        contract_number: no,
        subsidiary: resolveSub(r['CA_SUBSIDIARY']),
        facility_type_id: ftId,
        finance_institution: S(r['CA_FINANCE INSTITUTION']),
        currency: S(r['CA_CURRENCY']) ?? 'THB',
        credit_line: N(r['CA_CREDIT LINE']) ?? 0,
        credit_line_foreign: N(r['CA_CREDIT LINE (Foreign)']),
        fx_rate: N(r['CA_FX RATE']),
        fx_rate_date: D(r['CA_FX RATE DATE']),
        credit_type: S(r['CA_CREDIT TYPE']) ?? 'Non Revolving',
        rollover_max_days: N(r['CA_ROLL OVER CONDITION MAXIMUM TERM (DAYS)']),
        rollover_max_times: N(r['CA_MAXIMUM ROLL OVER (TIMES)']),
        conversion_date: D(r['CA_CONVERSION DATE']),
        conversion_rate: N(r['CA_CONVERSION RATE']),
        start_date: D(r['CA_START DATE']),
        end_date: D(r['CA_END DATE']),
        status: S(r['CA_AGREEMENT STATUS']) ?? 'Draft',
        rate_cards: rateCards,
      };
      const caExId = caExistById.get(no);
      if (caExId) {
        // upsert — อัปเดต CA เดิม
        const { error } = await supabase.from('credit_agreements').update(payload).eq('id', caExId);
        if (error) { fail(SHEETS.contract, r.__row, 'CA_CONTRACT NUMBER', error); continue; }
        caIds.set(no, caExId);
        caIdByName.set(payload.ca_name ?? '', caExId);
        sum.ca.existing++;
      } else {
        const { data, error } = await supabase.from('credit_agreements').insert(payload).select('id,ca_name').single();
        if (error) { fail(SHEETS.contract, r.__row, 'CA_CONTRACT NUMBER', error); continue; }
        caIds.set(no, data!.id);
        caIdByName.set(data!.ca_name, data!.id);
        sum.ca.created++;
      }
    }
  }

  // steps per TX from sheet 03
  const stepsByTx = new Map<string, ParsedRow[]>();
  for (const r of p.schedule) {
    const key = `${S(r['TX_MODULE'])}|${S(r['TX_NUMBER'])}`;
    stepsByTx.set(key, [...(stepsByTx.get(key) ?? []), r]);
  }

  // ---- 3. Transactions per module
  log('กำลังสร้าง Transaction...');
  const addDays = (d: string | null, days: number | null): string | null => {
    if (!d || days == null) return null;
    const dt = new Date(d);
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().slice(0, 10);
  };

  // unique field per module — เช็คก่อน insert กัน duplicate ตอน re-run
  const UNIQ: Record<string, [string, string]> = {
    PN: ['promissory_notes', 'name'], LG: ['letter_guarantees', 'name'],
    BG: ['letter_guarantees', 'name'], SBLC: ['letter_guarantees', 'name'],
    LC: ['letters_of_credit', 'lc_no'], FP: ['floor_plans', 'fp_no'],
    OD: ['overdrafts', 'od_no'], TR: ['trust_receipts', 'tr_no'],
    FXF: ['fx_forwards', 'fxf_no'], Loan: ['loans', 'loan_no'],
    'Hire Purchase': ['leases', 'lease_no'], Leasing: ['leases', 'lease_no'],
    'Leasing Other': ['leases', 'lease_no'],
  };

  for (const r of p.contract) {
    const mod = S(r['TX_MODULE']) ?? '';
    const txNo = S(r['TX_NUMBER']) ?? '';
    const key = `${mod}|${txNo}`;
    const caId = caIds.get(S(r['CA_CONTRACT NUMBER']) ?? '') ?? null;
    const noBankLease = mod === 'Leasing Other';
    // dependency guard — CA ไม่สำเร็จ → ข้าม TX (กัน orphan)
    if (!caId && !noBankLease) {
      fail(SHEETS.contract, r.__row, 'TX_NUMBER', `ข้าม ${txNo} — CA "${S(r['CA_CONTRACT NUMBER'])}" import ไม่สำเร็จ`);
      continue;
    }
    // upsert — มีอยู่แล้ว → อัปเดตทับ (ไม่ข้าม) เพื่อให้ import ซ้ำแล้วค่าล่าสุดเข้าเสมอ
    const [uTable, uField] = UNIQ[mod] ?? [];
    let existingTxId: string | null = null;
    if (uTable) {
      const { data: dup } = await supabase.from(uTable).select('id').eq(uField, txNo).limit(1);
      if (dup && dup.length > 0) existingTxId = dup[0].id as string;
    }
    // insert ถ้ายังไม่มี · update ถ้ามีอยู่แล้ว (upsert)
    const writeTx = (table: string, payload: any) =>
      existingTxId
        ? supabase.from(table).update(payload).eq('id', existingTxId)
        : supabase.from(table).insert(payload);
    const fi = S(r['TX_FINANCE INSTITUTION']);
    const status = S(r['TX_STATUS']) ?? 'Draft';
    const currency = S(r['TX_CURRENCY']) ?? 'THB';
    const amount = N(r['TX_AMOUNT']) ?? 0;
    const txDate = D(r['TX_TRANSACTION DATE']);
    const termDays = N(r['TX_TERM (DAYS)']);
    const maturity = D(r['TX_MATURITY DATE']) ?? addDays(txDate, termDays);
    const rate = N(r['TX_INTEREST RATE (%)']);
    const rateCards = ratesByTx.get(key) ?? [];
    // ดอกเดียวตลอด (ไม่กรอก sheet Interest Rate แยก) → สร้าง rate card จาก TX_INTEREST RATE
    // เพื่อให้ตารางงวด (ที่คำนวณจาก rate_cards) ของทุกโมดูลขึ้นได้ ไม่ใช่ว่างเปล่า
    if (rateCards.length === 0 && rate != null) {
      rateCards.push({ type: S(r['TX_INTEREST TYPE']) ?? 'Fixed', rate, condition: 0, start_date: txDate } as any);
    }
    const steps = (stepsByTx.get(key) ?? []).sort((a, b) => (N(a['STEP PERIOD']) ?? 0) - (N(b['STEP PERIOD']) ?? 0));
    // Department/Location พิมพ์อิสระ (ยังไม่มี master จริงจาก NetSuite) — เก็บใน remark กันข้อมูลหาย · จับคู่เป็นรหัสทีหลัง
    const segParts = [
      S(r['TX_DEPARTMENT']) ? `Department: ${S(r['TX_DEPARTMENT'])}` : null,
      S(r['TX_LOCATION']) ? `Location: ${S(r['TX_LOCATION'])}` : null,
    ].filter(Boolean);
    const segRemark = segParts.length ? { remark: segParts.join(' · ') } : {};

    try {
      let error: any = null;
      if (mod === 'PN') {
        ({ error } = await writeTx('promissory_notes', {
          ...segRemark,
          name: txNo, pn_number: S(r['TX_BANK REFERENCE']) ?? txNo, ca_id: caId,
          facility_type_id: resolveFT(r['CA_FACILITY TYPE']) ?? resolveFT(mod),
          finance_institution: fi, transaction_date: txDate, maturity_date: maturity,
          term_days: termDays, amount, currency, effective_rate: rate, status,
          rate_cards: rateCards,   // ให้ตารางงวด (Schedule Calculate) คำนวณขึ้น
        }));
      } else if (mod === 'LG' || mod === 'BG' || mod === 'SBLC') {
        ({ error } = await writeTx('letter_guarantees', {
          ...segRemark,
          lg_no: S(r['TX_BANK REFERENCE']) ?? txNo, name: txNo,
          lg_type: mod === 'LG' ? 'L/G' : mod === 'BG' ? 'B/G' : 'SBLC', ca_id: caId,
          finance_institution: fi, beneficiary: S(r['TX_BENEFICIARY']),
          amount, currency, amount_foreign: N(r['TX_AMOUNT (FOREIGN)']),
          issue_date: D(r['TX_START DATE']) ?? D(r['TX_ISSUE DATE']), expiry_date: D(r['TX_END DATE']),
          payment_cycle: S(r['TX_PAYMENT CYCLE']), payment_date: D(r['TX_PAYMENT DATE']),
          fee_amount: N(r['TX_FEE AMOUNT']),
          prepaid: String(r['TX_PREPAID'] ?? '').trim().toLowerCase() === 'yes',
          status, rate_cards: rateCards,
        }));
      } else if (mod === 'LC') {
        ({ error } = await writeTx('letters_of_credit', {
          ...segRemark,
          lc_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          beneficiary: S(r['TX_BENEFICIARY']), applicant: S(r['TX_APPLICANT']),
          currency, amount_foreign: N(r['TX_AMOUNT (FOREIGN)']),
          conversion_rate: N(r['TX_FX RATE → THB']), amount,
          issue_date: D(r['TX_ISSUE DATE']) ?? txDate, transaction_date: txDate, term_days: termDays,
          expiry_date: D(r['TX_END DATE']) ?? addDays(D(r['TX_ISSUE DATE']) ?? txDate, termDays),
          fee_mode: 'full_term', fee_rate: rate ?? 0,  // LC ไม่มีดอกเบี้ย — ใช้ TX_INTEREST RATE เป็น fee rate
          fee_amount: Math.round(amount * (rate ?? 0) / 100 * 100) / 100,  // full_term: amount × fee_rate%
          status,
        }));
      } else if (mod === 'FP') {
        ({ error } = await writeTx('floor_plans', {
          ...segRemark,
          fp_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          start_date: txDate, end_date: maturity,
          transaction_date: txDate, maturity_date: maturity, term_days: termDays,
          amount, currency, cap_pct: N(r['TX_CAP % (เพดานเบิกต่อรถ)']),
          bank_ref: S(r['TX_BANK REFERENCE']), status, rate_cards: rateCards,
        }));
      } else if (mod === 'OD') {
        ({ error } = await writeTx('overdrafts', {
          ...segRemark,
          od_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          amount, facility_limit: amount, account_no: S(r['TX_BANK REFERENCE']),
          start_date: txDate,
          transaction_date: txDate, currency, effective_rate: rate, status, rate_cards: rateCards,
        }));
      } else if (mod === 'TR') {
        ({ error } = await writeTx('trust_receipts', {
          ...segRemark,
          tr_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          supplier: S(r['TX_SUPPLIER']), due_date: maturity,
          transaction_date: txDate, maturity_date: maturity,
          term_days: termDays, amount, currency, effective_rate: rate, status, rate_cards: rateCards,
        }));
      } else if (mod === 'FXF') {
        ({ error } = await writeTx('fx_forwards', {
          ...segRemark,
          fxf_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          deal_date: txDate, value_date: maturity,
          transaction_date: txDate, maturity_date: maturity, term_days: termDays,
          direction: S(r['TX_DIRECTION']), currency,
          notional_amount_foreign: N(r['TX_NOTIONAL AMOUNT (FOREIGN)']),
          forward_rate: N(r['TX_FORWARD RATE']), spot_rate: N(r['TX_SPOT RATE']),
          amount_thb: amount, status,
        }));
      } else if (mod === 'Loan') {
        const first = steps[0];
        const loanPayload: any = {
          ...segRemark,
          loan_no: txNo, name: txNo, ca_id: caId, finance_institution: fi,
          amount, principal: amount, currency, annual_rate: rate ?? rateCards[0]?.rate ?? 0,
          term_months: N(r['TX_TERM (MONTHS)']), transaction_date: txDate,
          start_date: D(r['TX_START DATE']) ?? txDate,
          installment_start_date: D(r['TX_INSTALLMENT START DATE']),
          payment_type: PT_CODE[S(r['TX_PAYMENT TYPE']) ?? ''] ?? S(r['TX_PAYMENT TYPE']),
          payment_timing: S(r['TX_PAYMENT TIMING'])?.toLowerCase() ?? 'arrears',
          // optional — เว้นว่าง = ค่า default ตรง dropdown
          balloon_option: S(r['TX_BALLOON OPTION']) ?? 'พร้อมค่างวด (รวมในงวดสุดท้าย)',
          allow_prepayment: S(r['TX_ALLOW PREPAYMENT']) ?? 'Yes — รองรับทั้ง Full + Partial',
          prepayment_fee_base: S(r['TX_FEE BASE']) ?? 'Outstanding Principal (หนี้คงเหลือ)',
          pay_eom: String(r['TX_PAY AT END OF MONTH'] ?? '').trim().toLowerCase() === 'yes',
          grace_months: N(r['TX_GRACE PERIOD (MONTHS)']) ?? 0,
          residual_value: N(r['TX_RESIDUAL VALUE (RV)']) ?? 0,
          include_rv_in_installment: String(r['TX_INCLUDE RV IN INSTALLMENT'] ?? 'yes').trim().toLowerCase() !== 'no',
          installment: first ? N(first['INSTALLMENT']) : null,
          step_period: steps.length > 1 ? N(steps[0]['STEP PERIOD']) : null,
          step_residual: steps.length > 1 ? N(steps[0]['STEP RV']) : null,
          bank_ref: S(r['TX_BANK REFERENCE']), status, rate_cards: rateCards,
        };
        // Step Payment หลายช่วง (cr) — ใส่เฉพาะเมื่อมีหลายช่วงจริง
        if (steps.length > 1) {
          loanPayload.step_phases = steps.map((s) => ({ fromPeriod: N(s['STEP PERIOD']) ?? 1, installment: N(s['INSTALLMENT']) ?? 0 }));
        }
        ({ error } = await writeTx('loans', loanPayload));
        // DB เดิมยังไม่มีคอลัมน์ step_phases → ลองใหม่โดยตัดออก (loan เข้าได้, เตือนให้รัน migration)
        if (error && /step_phases/.test(String(error?.message ?? error))) {
          delete loanPayload.step_phases;
          ({ error } = await writeTx('loans', loanPayload));
          if (!error) sum.errors.push({ sheet: SHEETS.contract, row: r.__row, column: 'TX_PAYMENT TYPE', message: `${txNo}: DB ยังไม่มีคอลัมน์ step_phases — import สำเร็จแต่ยังไม่บันทึกค่างวดต่อช่วง (รัน migration 0123 ก่อน)`, severity: 'warning' });
        }
        if (!error) sum.steps += steps.length;
      } else if (mod === 'Hire Purchase' || mod === 'Leasing' || mod === 'Leasing Other') {
        // ชื่อโมดูลในเทมเพลตตรงกับชนิดสัญญาในระบบตัวต่อตัว
        const leaseMode = mod === 'Hire Purchase' ? 'hp' : mod === 'Leasing' ? 'lease' : 'other';
        ({ error } = await writeTx('leases', {
          ...segRemark,
          lease_no: txNo,
          ca_id: leaseMode === 'other' ? null : caId,
          mode: leaseMode,
          use_bank_loan: leaseMode !== 'other',
          // subsidiary: HP/Leasing ดึงจาก CA · Leasing Other กรอกเอง (TX_SUBSIDIARY)
          subsidiary: resolveSub(r['CA_SUBSIDIARY']) ?? resolveSub(r['TX_SUBSIDIARY']),
          discount_rate: N(r['TX_DISCOUNT RATE (%)']),
          contract_number: S(r['TX_CONTRACT NUMBER']),
          contract_date: D(r['TX_CONTRACT DATE']),
          classification: S(r['TX_LEASE CLASSIFICATION']),
          payment_frequency: S(r['TX_PAYMENT FREQUENCY']),
          payment_start_date: D(r['TX_PAYMENT START DATE']),
          payment_type: PT_CODE[S(r['TX_PAYMENT TYPE']) ?? ''] ?? S(r['TX_PAYMENT TYPE']),
          asset_type: S(r['TX_ASSET TYPE']), asset_name: S(r['TX_ASSET NAME']),
          chassis_no: S(r['TX_CHASSIS NO']),
          vehicle_reg_no: S(r['TX_VEHICLE REGISTRATION NO']),
          vehicle_price: N(r['TX_VEHICLE PRICE']),
          down_payment: N(r['TX_DOWN PAYMENT']),
          upfront_payment: N(r['TX_UPFRONT PAYMENT']),
          prepaid_periods: N(r['TX_PREPAID PERIODS']),
          prepaid_amount: N(r['TX_PREPAID AMOUNT']),
          principal: N(r['TX_PRINCIPAL AMOUNT']) ?? amount,
          annual_rate: N(r['TX_CONTRACT INTEREST RATE (%)']) ?? rate ?? 0,
          rou_useful_life: N(r['TX_ROU USEFUL LIFE']),
          tfrs16_exemption: S(r['TX_TFRS16 EXEMPTION']),
          term_months: N(r['TX_TERM (MONTHS)']),
          start_date: D(r['TX_START DATE']) ?? txDate,
          balloon_amount: N(r['TX_BALLOON PAYMENT']) ?? 0,
          vat_rate: N(r['TX_VAT']) ?? 7,
          interest_basis: S(r['TX_INTEREST BASIS']) ?? 'Monthly',
          payment_timing: S(r['TX_PAYMENT TIMING'])?.toLowerCase() ?? 'arrears',
          bank_ref: S(r['TX_BANK REFERENCE']),
          vendor: S(r['TX_LESSOR']) ?? fi,
          vendor_id: resolveVendorId(S(r['TX_LESSOR']) ?? fi),  // ผูก Vendor Master → ฟอร์มถึงจะโชว์ LESSOR
          status,
        }));
        if (!error) sum.steps += steps.length;
      } else {
        continue;
      }
      if (error) fail(SHEETS.contract, r.__row, 'TX_MODULE', error);
      else {
        sum.tx[mod] = (sum.tx[mod] ?? 0) + 1;
        sum.rates += rateCards.length;
      }
    } catch (e) {
      fail(SHEETS.contract, r.__row, 'TX_MODULE', e);
    }
  }

  // ---- 4. Collateral + Guarantor (MA / CA level)
  log('กำลังสร้างหลักประกัน + ผู้ค้ำประกัน...');
  const maIdByName = maIds;
  const resolveTarget = (r: ParsedRow): { table: string; fk: Record<string, string> } | null => {
    const lvl = String(r['ผูกกับระดับ'] ?? '').trim().toUpperCase();
    if (lvl === 'MA') {
      const id = maIdByName.get(S(r['MA_MASTER AGREEMENT NAME']) ?? '');
      return id ? { table: 'ma', fk: { ma_id: id } } : null;
    }
    const id = caIdByName.get(S(r['CA_CREDIT AGREEMENT NAME']) ?? '');
    return id ? { table: 'ca', fk: { ca_id: id } } : null;
  };

  // ---- 4.5 Chassis (Sheet 06) — รถรายคันของ FP / PN / Loan
  if (p.chassis.length) {
    log('กำลังนำเข้ารถรายคัน (Chassis)...');
    // จัดกลุ่มตาม module|TX_NUMBER
    const byTx = new Map<string, ParsedRow[]>();
    for (const r of p.chassis) {
      const k = `${S(r['TX_MODULE']) ?? ''}|${S(r['TX_NUMBER']) ?? ''}`;
      if (!byTx.has(k)) byTx.set(k, []);
      byTx.get(k)!.push(r);
    }
    for (const [k, rows] of byTx) {
      const [mod, txNo] = k.split('|');
      try {
        if (mod === 'FP') {
          const { data: fp } = await supabase.from('floor_plans').select('id').eq('fp_no', txNo).maybeSingle();
          if (!fp) { fail(SHEETS.chassis, rows[0].__row, 'TX_NUMBER', `ไม่พบ FP ${txNo} ในระบบ`); continue; }
          const { data: ex } = await supabase.from('fp_chassis').select('chassis_no').eq('fp_id', fp.id);
          const have = new Set((ex ?? []).map((x: any) => x.chassis_no));
          const ins = rows.filter((r) => !have.has(S(r['CHASSIS NO.']))).map((r, i) => ({
            fp_id: fp.id,
            chassis_no: S(r['CHASSIS NO.']),
            engine_no: S(r['ENGINE NO.']),
            model: S(r['CAR MODEL']),
            chassis_price: N(r['ราคารถ (COST)']),
            amount: N(r['เบิก (AMOUNT)']) ?? N(r['ราคารถ (COST)']) ?? 0,
            current_location: S(r['LOCATION']),
            original_location: S(r['LOCATION']),
            sold_date: D(r['SOLD DATE']),
            sold_source: D(r['SOLD DATE']) ? 'manual' : null,
            status: 'Active',
            sort_order: (ex?.length ?? 0) + i,
          }));
          if (ins.length) {
            const { error } = await supabase.from('fp_chassis').insert(ins);
            if (error) { fail(SHEETS.chassis, rows[0].__row, 'CHASSIS NO.', error); continue; }
            sum.chassis += ins.length;
          }
        } else if (mod === 'Loan') {
          const { data: ln } = await supabase.from('loans').select('id').eq('loan_no', txNo).maybeSingle();
          if (!ln) { fail(SHEETS.chassis, rows[0].__row, 'TX_NUMBER', `ไม่พบ Loan ${txNo} ในระบบ`); continue; }
          const { data: ex } = await supabase.from('loan_chassis').select('chassis_no').eq('loan_id', ln.id);
          const have = new Set((ex ?? []).map((x: any) => x.chassis_no));
          const ins = rows.filter((r) => !have.has(S(r['CHASSIS NO.']))).map((r, i) => ({
            loan_id: ln.id,
            chassis_no: S(r['CHASSIS NO.']),
            engine_no: S(r['ENGINE NO.']),
            car_model: S(r['CAR MODEL']),
            location: S(r['LOCATION']),
            cost: N(r['ราคารถ (COST)']) ?? 0,
            status: 'Active',
            sort_order: (ex?.length ?? 0) + i,
          }));
          if (ins.length) {
            const { error } = await supabase.from('loan_chassis').insert(ins);
            if (error) { fail(SHEETS.chassis, rows[0].__row, 'CHASSIS NO.', error); continue; }
            sum.chassis += ins.length;
          }
        } else if (mod === 'PN') {
          const { data: pn } = await supabase.from('promissory_notes').select('id, chassis_list').eq('pn_no', txNo).maybeSingle();
          if (!pn) { fail(SHEETS.chassis, rows[0].__row, 'TX_NUMBER', `ไม่พบ P/N ${txNo} ในระบบ`); continue; }
          const list: any[] = Array.isArray(pn.chassis_list) ? [...pn.chassis_list] : [];
          const have = new Set(list.map((x: any) => x.chassis_no));
          let added = 0;
          for (const r of rows) {
            const chNo = S(r['CHASSIS NO.']);
            if (!chNo || have.has(chNo)) continue;
            list.push({
              id: `mig-${Date.now()}-${added}`,
              chassis_no: chNo,
              engine_no: S(r['ENGINE NO.']) ?? '',
              car_model: S(r['CAR MODEL']) ?? '',
              location: S(r['LOCATION']) ?? '',
              cost: N(r['ราคารถ (COST)']) ?? 0,
              status: 'Active',
            });
            added++;
          }
          if (added) {
            const { error } = await supabase.from('promissory_notes').update({ chassis_list: list }).eq('id', pn.id);
            if (error) { fail(SHEETS.chassis, rows[0].__row, 'CHASSIS NO.', error); continue; }
            sum.chassis += added;
          }
        }
      } catch (e) {
        fail(SHEETS.chassis, rows[0].__row, 'TX_NUMBER', e);
      }
    }
  }

  for (const r of p.collateral) {
    const t = resolveTarget(r);
    if (!t) { fail(SHEETS.collateral, r.__row, 'ผูกกับระดับ', 'หา MA/CA ปลายทางไม่เจอ (import ไม่สำเร็จก่อนหน้า?)'); continue; }
    // duplicate guard — fk + type + doc/chassis เดิม → ข้าม
    {
      const { data: ex } = await supabase.from(`${t.table}_collaterals`).select('type,doc_no,chassis_no').match(t.fk);
      const type = S(r['COLLATERAL TYPE']);
      const doc = S(r['DOCUMENT NO']); const ch = S(r['CHASSIS NO']);
      if ((ex ?? []).some((x: any) => x.type === type && (x.doc_no ?? null) === doc && (x.chassis_no ?? null) === ch)) {
        sum.errors.push({ sheet: SHEETS.collateral, row: r.__row, column: 'COLLATERAL TYPE', message: 'มีอยู่แล้ว — ข้าม (ไม่สร้างซ้ำ)', severity: 'warning' });
        continue;
      }
    }
    // fields jsonb — key ต้องตรงกับฟอร์ม COLLATERAL_FIELDS (ต่อประเภท)
    const fields: Record<string, any> = {
      asset_no: S(r['NS FA ASSET NO']),
      doc_no: S(r['DOCUMENT NO']),
      location: S(r['LOCATION']),
      value: N(r['VALUE']) ?? N(r['PLEDGE AMOUNT']),
      appraisal: N(r['APPRAISAL VALUE']),
      appr_date: D(r['APPRAISAL DATE']),
      mortgage_limit: N(r['MORTGAGE LIMIT']),
      chassis_no: S(r['CHASSIS NO']),
      vreg: S(r['VEHICLE REG NO']),
      vmodel: S(r['MODEL / YEAR']),
      pledge: N(r['PLEDGE AMOUNT']),
      bank: S(r['BANK']),
      acct_no: S(r['ACCOUNT NO']),
      acct_name: S(r['ACCOUNT NAME']),
      deposit_amt: N(r['DEPOSIT AMOUNT']),
      pledge_amt: N(r['PLEDGE AMOUNT']),
      desc: S(r['COLLATERAL DESCRIPTION']) ?? S(r['DESCRIPTION']),
      reg_no: S(r['REGISTRATION NO']),
      reg_limit: N(r['REGISTERED LIMIT']),
      secured_limit: N(r['SECURED LIMIT']),
    };
    // ลบ key ที่ว่าง เพื่อไม่ให้ fields รก
    Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
    // UI label (ไทย) → รหัสที่ระบบเก็บ
    const COL_TYPE: Record<string, string> = {
      'ที่ดิน/อสังหาริมทรัพย์': 'realestate', 'ยานพาหนะ': 'vehicle',
      'เงินฝากธนาคาร': 'deposit', 'หลักประกันทางธุรกิจ': 'business', 'อื่น ๆ': 'other', 'อื่นๆ': 'other',
      realestate: 'realestate', vehicle: 'vehicle', deposit: 'deposit', business: 'business', other: 'other',
    };
    const colType = COL_TYPE[S(r['COLLATERAL TYPE']) ?? ''] ?? 'other';
    const { error } = await supabase.from(`${t.table}_collaterals`).insert({
      ...t.fk, type: colType,
      doc_no: fields.doc_no, chassis_no: fields.chassis_no,
      value: fields.value, appraisal: fields.appraisal,
      fields, sort_order: 0,
    });
    if (error) fail(SHEETS.collateral, r.__row, 'COLLATERAL TYPE', error);
    else sum.collaterals++;
  }

  for (const r of p.guarantor) {
    const t = resolveTarget(r);
    if (!t) { fail(SHEETS.guarantor, r.__row, 'ผูกกับระดับ', 'หา MA/CA ปลายทางไม่เจอ (import ไม่สำเร็จก่อนหน้า?)'); continue; }
    // duplicate guard — fk + type + name เดิม → ข้าม
    {
      const { data: ex } = await supabase.from(`${t.table}_guarantors`).select('type,name').match(t.fk);
      const type = S(r['GUARANTOR TYPE']);
      const nm = S(r['NAME']) ?? S(r['COMPANY NAME']);
      if ((ex ?? []).some((x: any) => x.type === type && (x.name ?? null) === nm)) {
        sum.errors.push({ sheet: SHEETS.guarantor, row: r.__row, column: 'GUARANTOR TYPE', message: 'มีอยู่แล้ว — ข้าม (ไม่สร้างซ้ำ)', severity: 'warning' });
        continue;
      }
    }
    const fields = {
      name: S(r['NAME']), id_card: S(r['ID CARD NO (เลขบัตรประชาชน)']),
      company_name: S(r['COMPANY NAME']), tax_id: S(r['TAX ID (เลขทะเบียนนิติบุคคล)']),
      signatory: S(r['AUTHORIZED SIGNATORY']), amount: N(r['AMOUNT (บาท)']),
    };
    const { error } = await supabase.from(`${t.table}_guarantors`).insert({
      ...t.fk, type: S(r['GUARANTOR TYPE']),
      name: fields.name ?? fields.company_name, amount: fields.amount,
      fields, sort_order: 0,
    });
    if (error) fail(SHEETS.guarantor, r.__row, 'GUARANTOR TYPE', error);
    else sum.guarantors++;
  }

  log('เสร็จสิ้น');
  return sum;
}
