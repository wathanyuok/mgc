// Auto Gen PO — ดึง PO record จาก NetSuite (BRD FR-FP-020/021 · L&L #1)
//
// ⚠ STUB: ตอนนี้ยังไม่ต่อ NetSuite จริง — คืน mock data จาก MOCK_POS
//   ตอน SIT (1 ต.ค.) สลับ implementation ใน fetchNetSuitePO() จุดเดียว
//   เป็น GET {netsuite}/purchaseOrder?po={poNo} ตาม MGC PO Template V01R00
//
// กติกาตาม BRD:
//   BR-PN-023 ดึงผ่าน NetSuite เท่านั้น (ห้ามต่อตรง Carbon)
//   BR-PN-024 ห้าม PO Ref ซ้ำ — เช็คก่อน import (unique index ใน DB กันอีกชั้น)
//   A1: 404 ไม่พบ PO → แจ้งแล้วให้คีย์เอง · A2: 5xx → แจ้ง + ลองใหม่/คีย์เอง
import { supabase } from './supabase';

export interface NetSuitePOChassis {
  chassis_no: string;
  engine_no: string | null;
  model: string | null;
  price: number;
}

export interface NetSuitePO {
  po_no: string;
  vendor: string;
  chassis: NetSuitePOChassis[];
  amount: number;            // ผลรวมราคารถ
  expected_delivery: string; // ISO date
  currency: string;
}

// ── Mock PO data (ลบเมื่อต่อ NetSuite จริง) ─────────────────────────
const MOCK_POS: NetSuitePO[] = [
  {
    po_no: 'PO-2026-45678', vendor: 'BMW (Thailand) Co., Ltd.', currency: 'THB',
    expected_delivery: '2026-09-15',
    chassis: [
      { chassis_no: 'WBA8E5C50JG100001', engine_no: 'B48-100001', model: 'BMW 320i M Sport', price: 2450000 },
      { chassis_no: 'WBA8E5C50JG100002', engine_no: 'B48-100002', model: 'BMW 320i M Sport', price: 2450000 },
      { chassis_no: 'WBA8E5C50JG100003', engine_no: 'B48-100003', model: 'BMW 520d', price: 3350000 },
    ],
    amount: 8250000,
  },
  {
    po_no: 'PO-2026-45679', vendor: 'BYD Auto (Thailand) Co., Ltd.', currency: 'THB',
    expected_delivery: '2026-10-01',
    chassis: [
      { chassis_no: 'LGXC74C40S0200001', engine_no: null, model: 'BYD Seal AWD', price: 1290000 },
      { chassis_no: 'LGXC74C40S0200002', engine_no: null, model: 'BYD Seal AWD', price: 1290000 },
    ],
    amount: 2580000,
  },
];

// ── ข้อมูลสุ่มแบบคงที่ (deterministic) สำหรับ generate mock PO ─────────
// ใช้ hash ของเลข PO เลือกค่า → เลขเดิมได้ผลเดิมทุกครั้ง (preview นิ่ง)
const MOCK_VENDORS = [
  'BMW (Thailand) Co., Ltd.',
  'BYD Auto (Thailand) Co., Ltd.',
  'Mercedes-Benz (Thailand) Ltd.',
  'MG Sales (Thailand) Co., Ltd.',
];
const MOCK_MODELS = [
  ['BMW 320i M Sport', 2450000], ['BMW 520d', 3350000],
  ['BYD Seal AWD', 1290000], ['Mercedes-Benz C220d', 2790000], ['MG4 Electric', 869000],
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

/** สร้าง PO จำลองจากเลข PO แบบคงที่ — เลขเดิมได้ผลเดิม */
function generateMockPO(poNo: string): NetSuitePO {
  const h = hashStr(poNo.trim().toLowerCase());
  const vendor = MOCK_VENDORS[h % MOCK_VENDORS.length];
  const count = (h % 3) + 1; // 1–3 คัน
  const chassis: NetSuitePOChassis[] = [];
  let amount = 0;
  for (let i = 0; i < count; i++) {
    const [model, price] = MOCK_MODELS[(h + i) % MOCK_MODELS.length];
    const seq = String((h + i) % 100000).padStart(5, '0');
    chassis.push({
      chassis_no: `MOCK${seq}${String(i).padStart(2, '0')}`,
      engine_no: `ENG-${seq}`,
      model,
      price,
    });
    amount += price;
  }
  const d = new Date();
  d.setDate(d.getDate() + 30 + (h % 30));
  return {
    po_no: poNo.trim(),
    vendor,
    chassis,
    amount,
    expected_delivery: d.toISOString().slice(0, 10),
    currency: 'THB',
  };
}

/**
 * ดึง PO จาก NetSuite — STUB: แทนที่ body ฟังก์ชันนี้ตอนต่อ API จริง
 *
 * โหมด demo (hybrid):
 *   • 2 เลขจริง (MOCK_POS) → คืนข้อมูลชุด curated (หลายคันสมจริง)
 *   • เลขที่มีคำว่า "NOTFOUND" (หรือเว้นว่าง) → คืน 404 ไว้เทสเส้นทาง "ไม่พบ → คีย์เอง"
 *   • เลขอื่นๆ → generate mock อัตโนมัติ (พิมพ์อะไรก็ preview ได้)
 */
export async function fetchNetSuitePO(poNo: string): Promise<NetSuitePO> {
  await new Promise((r) => setTimeout(r, 600)); // จำลอง network latency
  const key = poNo.trim();

  // เลขจริงที่ curate ไว้ก่อน
  const curated = MOCK_POS.find((p) => p.po_no.toLowerCase() === key.toLowerCase());
  if (curated) return curated;

  // เลขสำหรับเทสเส้นทาง 404 (ไม่พบ)
  if (!key || /notfound|not-found|404/i.test(key)) {
    const err: any = new Error(`ไม่พบ PO "${poNo}" ใน NetSuite (404) — ตรวจเลข PO หรือคีย์ข้อมูลเอง`);
    err.status = 404;
    throw err;
  }

  // เลขอื่นๆ → generate mock (demo ผ่านเสมอ)
  return generateMockPO(key);
}

/** BR-PN-024 — เช็ค PO Ref ซ้ำข้ามทั้ง 3 ตาราง ก่อน import */
export async function assertPORefUnique(poNo: string, excludeTable?: string, excludeId?: string | null) {
  const tables: Array<[string, string]> = [
    ['promissory_notes', 'name'], ['floor_plans', 'fp_no'], ['loans', 'loan_no'],
  ];
  for (const [table, noCol] of tables) {
    let q = supabase.from(table).select(`id, ${noCol}`).eq('po_ref', poNo.trim()).limit(1);
    const { data } = await q;
    const hit = (data ?? [])[0] as any;
    if (hit && !(table === excludeTable && hit.id === excludeId)) {
      throw new Error(`PO "${poNo}" ถูกใช้สร้างรายการไปแล้ว (${table === 'promissory_notes' ? 'P/N' : table === 'floor_plans' ? 'FP' : 'Loan'} ${hit[noCol]}) — ห้ามใช้ซ้ำ`);
    }
  }
}
