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

/** ดึง PO จาก NetSuite — STUB: แทนที่ body ฟังก์ชันนี้ตอนต่อ API จริง */
export async function fetchNetSuitePO(poNo: string): Promise<NetSuitePO> {
  await new Promise((r) => setTimeout(r, 600)); // จำลอง network latency
  const po = MOCK_POS.find((p) => p.po_no.toLowerCase() === poNo.trim().toLowerCase());
  if (!po) {
    const err: any = new Error(`ไม่พบ PO "${poNo}" ใน NetSuite (404) — ตรวจเลข PO หรือคีย์ข้อมูลเอง`);
    err.status = 404;
    throw err;
  }
  return po;
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
