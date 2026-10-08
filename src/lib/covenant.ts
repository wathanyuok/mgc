// Covenant / Financial-ratio Trigger (ตาม MoM 30 ก.ย. 2026 เช้า บ.341/367/411/415/417)
//
// ช่อง Condition (D/E, DSCR) = "ค่าเกณฑ์ Trigger" ของสัญญา · ระบบดึงอัตราส่วน "จริง"
// ของบริษัทจาก NetSuite (Connected Service) มาเทียบกับเกณฑ์ → ผิดเงื่อนไข = Breach
// แจ้งเตือนทั้งระดับ M0 (Master Agreement) และ M1 (Credit Agreement)
//
// ⚠ การดึงจาก NetSuite ยังเป็น MOCK — รอ API/connector จริง (ติดป้าย "รอ Reconfirm")

export type CovenantStatus = 'pass' | 'breach' | 'unknown';

// ── ชุดข้อมูลที่ต้องดึงจาก NetSuite เพื่อคำนวณอัตราส่วน ─────────────────
//   D/E  = หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น
//   DSCR = กำไรจากการดำเนินงาน (EBITDA/NOI) ÷ ภาระชำระหนี้ (เงินต้น+ดอกเบี้ย)
export interface NetSuiteRatioInputs {
  totalLiabilities: number; // หนี้สินรวม
  totalEquity: number; // ส่วนของผู้ถือหุ้น
  netOperatingIncome: number; // กำไรจากการดำเนินงาน (EBITDA / NOI)
  debtService: number; // ภาระชำระหนี้ในงวด (เงินต้น + ดอกเบี้ย)
  [k: string]: number; // index signature — ให้เก็บลง jsonb (Record<string, number>) ได้
}

/** รายการ field ที่ดึงจาก NetSuite — ใช้แสดงบนหน้าจอ และเป็น spec การเชื่อม API จริง */
export const NETSUITE_FIELDS: { key: keyof NetSuiteRatioInputs; label: string; use: 'D/E' | 'DSCR' }[] = [
  { key: 'totalLiabilities', label: 'หนี้สินรวม (Total Liabilities)', use: 'D/E' },
  { key: 'totalEquity', label: 'ส่วนของผู้ถือหุ้น (Total Equity)', use: 'D/E' },
  { key: 'netOperatingIncome', label: 'กำไรจากการดำเนินงาน (EBITDA / NOI)', use: 'DSCR' },
  { key: 'debtService', label: 'ภาระชำระหนี้ · เงินต้น+ดอกเบี้ย (Debt Service)', use: 'DSCR' },
];

// ── ความถี่ในการดึงข้อมูล (Frequency) — เบื้องต้นรายเดือน ───────────────
export type RatioFrequency = 'monthly' | 'quarterly' | 'yearly';
export const RATIO_FREQUENCY_OPTIONS: { value: RatioFrequency; label: string }[] = [
  { value: 'monthly', label: 'รายเดือน (Monthly)' },
  { value: 'quarterly', label: 'รายไตรมาส (Quarterly)' },
  { value: 'yearly', label: 'รายปี (Yearly)' },
];
export const DEFAULT_RATIO_FREQUENCY: RatioFrequency = 'monthly';

/** อัตราส่วนจริงที่ดึงมา (จาก NetSuite) พร้อมตัวเลขตั้งต้นที่ใช้คำนวณ */
export interface CovenantActuals {
  de: number | null;
  dscr: number | null;
  inputs: NetSuiteRatioInputs;
  fetchedAt: string; // ISO timestamp
  source: string; // 'NetSuite (mock)'
}

/**
 * ค่าเกณฑ์ผ่านหรือไม่ · op เทียบ actual กับ threshold
 *   D/E มักเป็น '<=' (หนี้ต่อทุนต้องไม่เกิน) · DSCR มักเป็น '>=' (ความสามารถชำระต้องไม่ต่ำกว่า)
 *   actual/threshold เป็น null = ยังไม่รู้ → 'unknown' (ไม่ตัดสินว่า breach)
 */
export function evalCovenant(
  op: string | null | undefined,
  threshold: number | null | undefined,
  actual: number | null | undefined,
): CovenantStatus {
  if (threshold == null || actual == null || !op) return 'unknown';
  const t = Number(threshold);
  const a = Number(actual);
  if (!isFinite(t) || !isFinite(a)) return 'unknown';
  let ok: boolean;
  switch (op) {
    case '<=': ok = a <= t + 1e-9; break;
    case '<': ok = a < t; break;
    case '>=': ok = a >= t - 1e-9; break;
    case '>': ok = a > t; break;
    case '=':
    case '==': ok = Math.abs(a - t) < 1e-9; break;
    default: return 'unknown';
  }
  return ok ? 'pass' : 'breach';
}

/** รวมผลของทั้ง D/E และ DSCR — ถ้ามีตัวใด breach ถือว่า breach */
export function overallCovenant(statuses: CovenantStatus[]): CovenantStatus {
  if (statuses.some((s) => s === 'breach')) return 'breach';
  if (statuses.some((s) => s === 'pass')) return 'pass';
  return 'unknown';
}

// ── MOCK: ดึงอัตราส่วนจาก NetSuite ─────────────────────────────────────
// ค่าคงที่ต่อ (บริษัท + เดือน) เพื่อให้ผลไม่กระพริบระหว่างเดือนเดียวกัน
// แทนที่ทั้งก้อนนี้ด้วยการเรียก NetSuite API จริงเมื่อ connector พร้อม
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

/** MOCK NetSuite fetch — คืนตัวเลขตั้งต้น + อัตราส่วน จำลองคงที่ต่อบริษัท/เดือน */
export async function fetchRatiosFromNetSuite(subsidiary: string): Promise<CovenantActuals> {
  // จำลองดีเลย์เครือข่าย
  await new Promise((r) => setTimeout(r, 400));
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `${subsidiary || 'UNKNOWN'}|${ym}`;
  // ตัวเลขตั้งต้นจำลอง (หน่วยบาท) — คงที่ต่อบริษัท/เดือน
  const totalEquity = Math.round((50_000_000 + hashString(key + '|eq') * 150_000_000) / 1000) * 1000;
  const totalLiabilities = Math.round(totalEquity * (0.5 + hashString(key + '|de') * 2.5) / 1000) * 1000;
  const debtService = Math.round((5_000_000 + hashString(key + '|ds') * 25_000_000) / 1000) * 1000;
  const netOperatingIncome = Math.round(debtService * (0.8 + hashString(key + '|noi') * 1.7) / 1000) * 1000;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const de = totalEquity > 0 ? round2(totalLiabilities / totalEquity) : null;
  const dscr = debtService > 0 ? round2(netOperatingIncome / debtService) : null;
  return {
    de,
    dscr,
    inputs: { totalLiabilities, totalEquity, netOperatingIncome, debtService },
    fetchedAt: new Date().toISOString(),
    source: 'NetSuite (mock)',
  };
}
