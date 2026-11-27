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
import { isChassisHolderOpen, isCommittedHolder } from './chassis-overlap';

export interface ChassisInventory {
  id: string;
  chassis_no: string;
  engine_no: string;
  car_model: string;
  sub_model: string;   // รุ่นย่อย/trim (เช่น M Sport, xDrive40d) — ใช้กรอง Sub Model
  invoice: string;     // เลข Invoice จาก NetSuite (ตอนรับรถเข้า Item Receipt) — ใช้ค้นหา + แสดงบนรายการรถ
  location: string;
  cost: number;
  // หมายเหตุ: NetSuite Inventory ไม่ได้เก็บเลข PO ไว้ที่ตัว item (PO อยู่บนเอกสาร PO / Item Receipt)
  //           การดึงรถตามเลข PO จึงทำที่ PO Ref Import ไม่ใช่ที่ Lookup Inventory นี้
}

// ─── Mock Data ──────────────────────────────────────────────────────
const MOCK_INVENTORY: ChassisInventory[] = [
  { id: 'inv-1', chassis_no: 'MMTFR86A8RH001238', engine_no: 'B38A15-1107238', car_model: 'MINI Cooper S 5DR', sub_model: 'Cooper S', invoice: 'INV-2026-0001', location: 'MAG Phaholyothin', cost: 2_390_000 },
  { id: 'inv-2', chassis_no: 'WBA8E5C50JG924765', engine_no: 'B48B20-8847213', car_model: 'BMW 320i M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0002', location: 'MAG Rama 9', cost: 1_800_000 },
  { id: 'inv-3', chassis_no: 'WMW7D5108K5K12345', engine_no: 'B38A15-3320145', car_model: 'MINI Cooper Country', sub_model: 'Countryman', invoice: 'INV-2026-0003', location: 'MAG Bangna', cost: 1_650_000 },
  { id: 'inv-4', chassis_no: 'WBAJB4C50KBV98762', engine_no: 'B48B20-9912034', car_model: 'BMW 530e M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0004', location: 'MAG HQ Showroom', cost: 3_450_000 },
  { id: 'inv-5', chassis_no: 'WAUE8AF44LA011234', engine_no: 'DLVA-4451209', car_model: 'Audi A6 45 TFSI', sub_model: '45 TFSI', invoice: 'INV-2026-0005', location: 'MAG Lat Phrao', cost: 3_290_000 },
  { id: 'inv-6', chassis_no: 'JHMFC1F70KX021234', engine_no: 'L15B7-2203471', car_model: 'Honda Civic RS', sub_model: 'RS', invoice: 'INV-2026-0006', location: 'MAG Rangsit', cost: 1_090_000 },
  { id: 'inv-7', chassis_no: 'MMF24FW020Y000001', engine_no: 'B58B30-1207854', car_model: 'BMW X7 xDrive40d', sub_model: 'xDrive40d', invoice: 'INV-2026-0007', location: 'MAG Latphrao', cost: 5_990_000 },
  { id: 'inv-8', chassis_no: 'MMF24FW020Y000002', engine_no: 'B58B30-1208001', car_model: 'BMW X7 xDrive40d', sub_model: 'xDrive40d', invoice: 'INV-2026-0007', location: 'MAG Latphrao', cost: 5_990_000 },
  { id: 'inv-9', chassis_no: 'MMF24FW020Y000003', engine_no: 'B58B30-1208123', car_model: 'BMW X5 xDrive40i', sub_model: 'xDrive40i', invoice: 'INV-2026-0008', location: 'MAG Latphrao', cost: 4_290_000 },
  // ── เพิ่ม inventory ให้เยอะ → ทดสอบแบ่งหน้าหลายหน้า ──
  { id: 'inv-10', chassis_no: 'WBA5R7C06LFH10001', engine_no: 'B48B20-1000001', car_model: 'BMW 330i M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0010', location: 'MAG Rama 9', cost: 2_690_000 },
  { id: 'inv-11', chassis_no: 'WBA5R7C06LFH10002', engine_no: 'B48B20-1000002', car_model: 'BMW 330i M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0010', location: 'MAG Rama 9', cost: 2_690_000 },
  { id: 'inv-12', chassis_no: 'WBA7E2C01MCG20003', engine_no: 'B58B30-2000003', car_model: 'BMW 730Ld', sub_model: 'M Sport', invoice: 'INV-2026-0011', location: 'MAG HQ Showroom', cost: 6_990_000 },
  { id: 'inv-13', chassis_no: 'WBA7E2C01MCG20004', engine_no: 'B58B30-2000004', car_model: 'BMW 730Ld', sub_model: 'Pure Excellence', invoice: 'INV-2026-0012', location: 'MAG HQ Showroom', cost: 7_290_000 },
  { id: 'inv-14', chassis_no: 'WMW52DK05N2L30005', engine_no: 'B48A20-3000005', car_model: 'MINI Cooper SE', sub_model: 'Electric', invoice: 'INV-2026-0013', location: 'MAG Bangna', cost: 2_290_000 },
  { id: 'inv-15', chassis_no: 'WMW52DK05N2L30006', engine_no: 'B48A20-3000006', car_model: 'MINI Cooper SE', sub_model: 'Electric', invoice: 'INV-2026-0013', location: 'MAG Bangna', cost: 2_290_000 },
  { id: 'inv-16', chassis_no: 'WAUZZZF24PN040007', engine_no: 'DLVA-4000007', car_model: 'Audi A5 Coupe', sub_model: '40 TFSI', invoice: 'INV-2026-0014', location: 'MAG Lat Phrao', cost: 3_190_000 },
  { id: 'inv-17', chassis_no: 'WAUZZZF24PN040008', engine_no: 'DLVA-4000008', car_model: 'Audi Q5', sub_model: '45 TFSI quattro', invoice: 'INV-2026-0015', location: 'MAG Lat Phrao', cost: 3_590_000 },
  { id: 'inv-18', chassis_no: 'WAUZZZGY5PA050009', engine_no: 'EABP-5000009', car_model: 'Audi e-tron GT', sub_model: 'quattro', invoice: 'INV-2026-0016', location: 'MAG HQ Showroom', cost: 7_890_000 },
  { id: 'inv-19', chassis_no: 'W1K2230841A060010', engine_no: 'M254-6000010', car_model: 'Mercedes-Benz C300', sub_model: 'AMG Dynamic', invoice: 'INV-2026-0017', location: 'MAG Phaholyothin', cost: 3_290_000 },
  { id: 'inv-20', chassis_no: 'W1K2230841A060011', engine_no: 'M254-6000011', car_model: 'Mercedes-Benz C300', sub_model: 'AMG Dynamic', invoice: 'INV-2026-0017', location: 'MAG Phaholyothin', cost: 3_290_000 },
  { id: 'inv-21', chassis_no: 'W1K6G7HB0PA070012', engine_no: 'M256-7000012', car_model: 'Mercedes-Benz S350d', sub_model: 'Exclusive', invoice: 'INV-2026-0018', location: 'MAG HQ Showroom', cost: 8_490_000 },
  { id: 'inv-22', chassis_no: 'MRHGM6670PP080013', engine_no: 'L15B7-8000013', car_model: 'Honda Accord', sub_model: 'e:HEV RS', invoice: 'INV-2026-0019', location: 'MAG Rangsit', cost: 1_599_000 },
  { id: 'inv-23', chassis_no: 'MRHGM6670PP080014', engine_no: 'L15B7-8000014', car_model: 'Honda CR-V', sub_model: 'e:HEV ES', invoice: 'INV-2026-0020', location: 'MAG Rangsit', cost: 1_729_000 },
  { id: 'inv-24', chassis_no: 'MR0KB3CD0P9090015', engine_no: 'M20A-9000015', car_model: 'Toyota Camry', sub_model: 'HEV Premium', invoice: 'INV-2026-0021', location: 'MAG Bangna', cost: 1_899_000 },
  { id: 'inv-25', chassis_no: 'MR0KB3CD0P9090016', engine_no: 'M20A-9000016', car_model: 'Toyota Corolla Cross', sub_model: 'HEV Smart', invoice: 'INV-2026-0022', location: 'MAG Bangna', cost: 1_159_000 },
  { id: 'inv-26', chassis_no: 'MR0KB3CD0P9090017', engine_no: 'M20A-9000017', car_model: 'Toyota Fortuner', sub_model: 'Legender', invoice: 'INV-2026-0023', location: 'MAG Rangsit', cost: 1_899_000 },
  { id: 'inv-27', chassis_no: 'MPATFS86J00100018', engine_no: '4N15-100018', car_model: 'Mitsubishi Pajero Sport', sub_model: 'GT Premium', invoice: 'INV-2026-0024', location: 'MAG Rangsit', cost: 1_499_000 },
  { id: 'inv-28', chassis_no: 'MMBJYKL10PH110019', engine_no: '4N15-110019', car_model: 'Mitsubishi Triton', sub_model: 'Athlete', invoice: 'INV-2026-0025', location: 'คลัง A', cost: 1_059_000 },
  { id: 'inv-29', chassis_no: 'MPBTFS40J00120020', engine_no: 'RZ4E-120020', car_model: 'Isuzu MU-X', sub_model: 'Ultimate', invoice: 'INV-2026-0026', location: 'คลัง A', cost: 1_599_000 },
  { id: 'inv-30', chassis_no: 'MPBTFS40J00120021', engine_no: 'RZ4E-120021', car_model: 'Isuzu D-Max V-Cross', sub_model: '3.0 4WD', invoice: 'INV-2026-0027', location: 'คลัง A', cost: 1_199_000 },
  { id: 'inv-31', chassis_no: 'MNTBAAM10P0130022', engine_no: 'HR-130022', car_model: 'Nissan Almera', sub_model: 'VL Turbo', invoice: 'INV-2026-0028', location: 'MAG Lat Phrao', cost: 679_000 },
  { id: 'inv-32', chassis_no: 'MNTBAAM10P0130023', engine_no: 'HR-130023', car_model: 'Nissan Kicks', sub_model: 'e-POWER VL', invoice: 'INV-2026-0029', location: 'MAG Lat Phrao', cost: 1_099_000 },
  { id: 'inv-33', chassis_no: 'YV1LZK0P0P1140024', engine_no: 'B4204-140024', car_model: 'Volvo XC60', sub_model: 'B5 Ultimate', invoice: 'INV-2026-0030', location: 'MAG HQ Showroom', cost: 3_290_000 },
  { id: 'inv-34', chassis_no: 'YV1LZK0P0P1140025', engine_no: 'B4204-140025', car_model: 'Volvo XC90', sub_model: 'Recharge', invoice: 'INV-2026-0031', location: 'MAG HQ Showroom', cost: 4_690_000 },
  { id: 'inv-35', chassis_no: 'LRW3E7FA0PC150026', engine_no: 'DM-150026', car_model: 'Tesla Model 3', sub_model: 'Long Range', invoice: 'INV-2026-0032', location: 'MAG Bangna', cost: 1_799_000 },
  { id: 'inv-36', chassis_no: 'LRW3E7FA0PC150027', engine_no: 'DM-150027', car_model: 'Tesla Model Y', sub_model: 'Performance', invoice: 'INV-2026-0033', location: 'MAG Bangna', cost: 2_509_000 },
  { id: 'inv-37', chassis_no: 'LGXC24E40P0160028', engine_no: 'BYD-160028', car_model: 'BYD Atto 3', sub_model: 'Extended', invoice: 'INV-2026-0034', location: 'MAG Rangsit', cost: 1_199_000 },
  { id: 'inv-38', chassis_no: 'LGXC24E40P0160029', engine_no: 'BYD-160029', car_model: 'BYD Seal', sub_model: 'AWD Performance', invoice: 'INV-2026-0035', location: 'MAG Rangsit', cost: 1_599_000 },
  { id: 'inv-39', chassis_no: 'LVVDB21B0PD170030', engine_no: 'GWM-170030', car_model: 'GWM Haval H6', sub_model: 'HEV Ultra', invoice: 'INV-2026-0036', location: 'คลัง B', cost: 1_149_000 },
  { id: 'inv-40', chassis_no: 'LVVDB21B0PD170031', engine_no: 'GWM-170031', car_model: 'GWM Tank 300', sub_model: 'HEV', invoice: 'INV-2026-0037', location: 'คลัง B', cost: 1_899_000 },
  { id: 'inv-41', chassis_no: 'WBA8E5C50JG924999', engine_no: 'B48B20-8849999', car_model: 'BMW 320i M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0038', location: 'MAG Rama 9', cost: 1_820_000 },
  { id: 'inv-42', chassis_no: 'WBAJB4C50KBV98999', engine_no: 'B48B20-9919999', car_model: 'BMW 530e M Sport', sub_model: 'M Sport', invoice: 'INV-2026-0039', location: 'MAG HQ Showroom', cost: 3_480_000 },
  { id: 'inv-43', chassis_no: 'MMTFR86A8RH001999', engine_no: 'B38A15-1109999', car_model: 'MINI Cooper S 5DR', sub_model: 'Cooper S', invoice: 'INV-2026-0040', location: 'MAG Phaholyothin', cost: 2_410_000 },
  { id: 'inv-44', chassis_no: 'JHMFC1F70KX029999', engine_no: 'L15B7-2209999', car_model: 'Honda Civic RS', sub_model: 'RS', invoice: 'INV-2026-0041', location: 'MAG Rangsit', cost: 1_110_000 },
  { id: 'inv-45', chassis_no: 'WAUE8AF44LA019999', engine_no: 'DLVA-4459999', car_model: 'Audi A6 45 TFSI', sub_model: '45 TFSI', invoice: 'INV-2026-0042', location: 'MAG Lat Phrao', cost: 3_310_000 },
  // ── รถทดสอบ "ตรวจเลขตัวถังซ้ำ" (คู่กับ seed_chassis_conflict_test.sql) ──
  { id: 'inv-chdup-a', chassis_no: 'CHDUP-A-ACTIVE',  engine_no: 'ENG-A', car_model: 'Toyota Vios (test)',  sub_model: '1.5 G',   invoice: 'INV-TEST-A', location: 'คลัง A', cost: 1_000_000 },
  { id: 'inv-chdup-b', chassis_no: 'CHDUP-B-DRAFT',   engine_no: 'ENG-B', car_model: 'Honda City (test)',   sub_model: 'RS',      invoice: 'INV-TEST-B', location: 'คลัง A', cost: 1_000_000 },
  { id: 'inv-chdup-c', chassis_no: 'CHDUP-C-XBANK',   engine_no: 'ENG-C', car_model: 'Isuzu D-Max (test)',  sub_model: 'Hi-Lander', invoice: 'INV-TEST-C', location: 'คลัง A', cost: 1_000_000 },
  { id: 'inv-chdup-d', chassis_no: 'CHDUP-D-APPROVE', engine_no: 'ENG-D', car_model: 'Mazda 2 (test)',      sub_model: 'SP',      invoice: 'INV-TEST-D', location: 'คลัง B', cost: 1_000_000 },
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
          c.sub_model.toLowerCase().includes(q) ||
          c.invoice.toLowerCase().includes(q) ||
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

export type ConflictModule = 'HP' | 'Loan' | 'FP' | 'PN' | 'LEASE' | 'LC' | 'TR';
// LEASE = Leasing (ใช้สินเชื่อ) mode='other' with asset_type='ยานพาหนะ'

export interface ChassisConflict {
  module: ConflictModule;
  contract_no: string;
  status: string;
  bank: string;        // existing contract's finance institution
  same_bank: boolean;  // matches caller's currentBank → true means BLOCK, false means WARN
}

// ชื่อโมดูลแบบอ่านง่ายสำหรับข้อความแจ้งเตือน (แทนรหัสย่อ HP/LEASE/PN...)
const MODULE_FRIENDLY: Record<ConflictModule, string> = {
  HP: 'HP', LEASE: 'Leasing', Loan: 'Loan', FP: 'Floor Plan', PN: 'P/N', LC: 'L/C', TR: 'T/R',
};

// เดิมที่นี่ระบุ "รายชื่อสถานะที่ยังเปิดอยู่" แยกไว้ 4 ชุด แล้วส่งเข้า .in('status', …)
// วิธีนั้นพังเงียบ: รายชื่อของ P/N ตกค่า 'Active' ไป (เพิ่มเข้าฐานข้อมูลทีหลัง)
// ทำให้การตรวจเลขตัวถังซ้ำมองไม่เห็น P/N ที่มีผลบังคับใช้เลยแม้แต่ฉบับเดียว — และไม่มี error ให้เห็น
//
// เปลี่ยนมาใช้วิธีเดียวกับรายงานเลขตัวถังซ้ำ: ดึงมาแล้วคัด "เฉพาะสถานะที่ปิดแล้ว" ออก
// ถ้ามีสถานะใหม่เพิ่มมาในอนาคต ระบบจะรายงานเกินไว้ก่อน (ปลอดภัยกว่าเงียบ) และทั้งสองที่ให้ผลตรงกัน

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

  // 1) สัญญาเช่าทุกชนิด — Hire Purchase · Leasing · Leasing Other ที่ผูกรถ
  //    ต้องตรวจทั้งตาราง ไม่ข้ามตามชนิด เพราะรถคันเดียวห้ามอยู่ 2 สัญญาพร้อมกัน
  //    สัญญาที่กำลังแก้อยู่ถูกคัดออกด้วย excludeContractId แทน
  {
    const { data, error } = await supabase
      .from('leases')
      .select('id, lease_no, mode, chassis_no, status, ca_id, credit_agreements(finance_institution)')
      .eq('chassis_no', chassisNo);
    if (error) console.warn('[Chassis Conflict — HP/LEASE] error:', error);
    (data ?? []).forEach((r: any) => {
      if (excludeContractId && r.id === excludeContractId) return;
      if (!isChassisHolderOpen(r.status)) return;
      const mod: ConflictModule = r.mode === 'hp' ? 'HP' : 'LEASE';   // Leasing และ Leasing Other ใช้รหัสเดียวกัน
      const bank = (r.credit_agreements?.finance_institution as string | undefined) ?? '';
      conflicts.push({
        module: mod, contract_no: r.lease_no, status: r.status,
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
          .in('id', loanIds);
        (loans ?? []).forEach((loan: any) => {
          if (excludeContractId && loan.id === excludeContractId) return;
          if (!isChassisHolderOpen(loan.status)) return;
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
          .in('id', fpIds);
        (fps ?? []).forEach((fp: any) => {
          if (excludeContractId && fp.id === excludeContractId) return;
          if (!isChassisHolderOpen(fp.status)) return;
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
      .select('id, name, status, chassis_list, finance_institution');
    if (error) console.warn('[Chassis Conflict — PN]', error);
    (data ?? []).forEach((pn: any) => {
      if (excludeContractId && pn.id === excludeContractId) return;
      if (!isChassisHolderOpen(pn.status)) return;
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

  // 5) L/C chassis — sub-table → letters_of_credit.finance_institution (MoM 30Sep2026)
  if (excludeModule !== 'LC') {
    const { data, error } = await supabase
      .from('lc_chassis')
      .select('chassis_no, lc_id')
      .eq('chassis_no', chassisNo);
    if (error) {
      console.warn('[Chassis Conflict — LC] table missing or RLS:', error.message);
    } else if (data && data.length > 0) {
      const lcIds = data.map((r: any) => r.lc_id).filter(Boolean);
      if (lcIds.length > 0) {
        const { data: lcs } = await supabase
          .from('letters_of_credit')
          .select('id, lc_no, status, finance_institution')
          .in('id', lcIds);
        (lcs ?? []).forEach((lc: any) => {
          if (excludeContractId && lc.id === excludeContractId) return;
          if (!isChassisHolderOpen(lc.status)) return;
          const bank = (lc.finance_institution as string | undefined) ?? '';
          conflicts.push({
            module: 'LC', contract_no: lc.lc_no, status: lc.status,
            bank, same_bank: !!curBank && norm(bank) === curBank,
          });
        });
      }
    }
  }

  // 6) T/R chassis — sub-table → trust_receipts.finance_institution (รอ Reconfirm)
  if (excludeModule !== 'TR') {
    const { data, error } = await supabase
      .from('tr_chassis')
      .select('chassis_no, tr_id')
      .eq('chassis_no', chassisNo);
    if (error) {
      console.warn('[Chassis Conflict — TR] table missing or RLS:', error.message);
    } else if (data && data.length > 0) {
      const trIds = data.map((r: any) => r.tr_id).filter(Boolean);
      if (trIds.length > 0) {
        const { data: trs } = await supabase
          .from('trust_receipts')
          .select('id, tr_no, status, finance_institution')
          .in('id', trIds);
        (trs ?? []).forEach((tr: any) => {
          if (excludeContractId && tr.id === excludeContractId) return;
          if (!isChassisHolderOpen(tr.status)) return;
          const bank = (tr.finance_institution as string | undefined) ?? '';
          conflicts.push({
            module: 'TR', contract_no: tr.tr_no, status: tr.status,
            bank, same_bank: !!curBank && norm(bank) === curBank,
          });
        });
      }
    }
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
  // บล็อกเฉพาะ "ธนาคารเดียวกัน + สัญญามีผลผูกพันแล้ว (Active/Approved/อยู่ระหว่างทำรายการ)"
  // ธนาคารเดียวกันแต่ยังเป็น Draft/รออนุมัติ → เตือนอย่างเดียว (เป็นการจองล่วงหน้า บันทึกผ่านได้)
  // ต่างธนาคารทุกสถานะ → เตือน
  const isBlocker = (c: ChassisConflict) => c.same_bank && isCommittedHolder(c.status);
  return {
    blockers: conflicts.filter(isBlocker),
    warnings: conflicts.filter((c) => !isBlocker(c)),
  };
}

// ─── ด่านตรวจตอนอนุมัติ (Q2) ─────────────────────────────────────────
// Draft/รออนุมัติ ไม่บล็อกตอน Save (classifyConflicts ให้เป็นแค่ warning) — จองคันเดียวกันได้หลาย Draft
// แต่ตอน "อนุมัติ" ต้องตรวจซ้ำ: ถ้าชนกับสัญญาที่ "มีผลแล้ว" ของธนาคารเดียวกัน ต้องกันไว้
// (เช่น Draft อีกใบถูกอนุมัติไปก่อน กลายเป็น Active → ใบนี้อนุมัติตามไม่ได้)
// mirror อาร์กิวเมนต์เดียวกับที่ Save handler ของแต่ละโมดูลเรียก checkChassisConflict
export async function approveChassisGuard(
  chassisNos: (string | null | undefined)[],
  excludeModule: ConflictModule | undefined,
  excludeContractId: string | undefined,
  currentBank: string | null | undefined,
): Promise<{ ok: boolean; message?: string }> {
  const seen = new Set<string>();
  const blockers: ChassisConflict[] = [];
  for (const raw of chassisNos) {
    const chNo = (raw ?? '').trim();
    if (!chNo || seen.has(chNo)) continue;
    seen.add(chNo);
    const conflicts = await checkChassisConflict(chNo, excludeModule, excludeContractId, currentBank);
    blockers.push(...classifyConflicts(conflicts).blockers);
  }
  if (blockers.length === 0) return { ok: true };
  // รูปแบบ: "LSE-DUP-02 (Leasing ของ KBANK) ที่อนุมัติแล้ว" — อ่านง่าย ไม่ใช้ศัพท์ (Active)
  const message = blockers.map((x) => {
    const label = MODULE_FRIENDLY[x.module] ?? x.module;
    return x.bank
      ? `${x.contract_no} (${label} ของ ${x.bank}) ที่อนุมัติแล้ว`
      : `${x.contract_no} (${label}) ที่อนุมัติแล้ว`;
  }).join(', ');
  return { ok: false, message };
}
