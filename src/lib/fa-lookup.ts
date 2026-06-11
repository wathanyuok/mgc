// FA Lookup Service — Mock NetSuite Fixed Asset Master
// Per MoM_MGC_LoanLease_NetSuite §5 — รถของ MCR ที่ให้เช่า, ที่ดิน, อาคาร
//
// Used by:
//   1. CollateralCards (MA/CA) — type = realestate/vehicle/business
//   2. LeaseDetail — IFRS 16 Pure (อาคาร/ที่ดิน) + MCR Lease
//
// Replace mock with real NetSuite SuiteTalk REST API when Spec available.

export type FAType = 'realestate' | 'vehicle' | 'building' | 'equipment' | 'other';

export interface FixedAsset {
  asset_no: string;          // FA-XXXX (NetSuite Asset Number)
  description: string;
  type: FAType;
  book_value: number;        // ราคาตามบัญชี (NBV)
  acquisition_date: string;  // วันที่ซื้อ/รับเข้า
  location: string | null;
  // realestate / building specific
  doc_no?: string;           // โฉนด/เลขเอกสาร
  appraisal_value?: number;
  appraisal_date?: string;
  // vehicle specific
  vreg?: string;             // ทะเบียนรถ
  vmodel?: string;           // รุ่น/ปี
  chassis_no?: string;       // เลขตัวถัง (link with chassis_lookup)
  // business specific
  registration_no?: string;  // เลขทะเบียนสินทรัพย์ธุรกิจ
}

// ─── Mock Data ──────────────────────────────────────────────────────
const MOCK_FA: FixedAsset[] = [
  // Real Estate
  {
    asset_no: 'FA-2024-001',
    description: 'อาคารสำนักงานใหญ่ ชั้น 10-12',
    type: 'building',
    book_value: 250_000_000,
    acquisition_date: '2020-03-15',
    location: 'ลาดพร้าว, กรุงเทพฯ',
    doc_no: 'NA-12345',
    appraisal_value: 320_000_000,
    appraisal_date: '2025-01-15',
  },
  {
    asset_no: 'FA-2024-002',
    description: 'ที่ดิน 5 ไร่ — สีลม',
    type: 'realestate',
    book_value: 850_000_000,
    acquisition_date: '2018-09-10',
    location: 'สีลม, กรุงเทพฯ',
    doc_no: 'นส.3 / 5678',
    appraisal_value: 1_200_000_000,
    appraisal_date: '2024-12-01',
  },
  {
    asset_no: 'FA-2024-003',
    description: 'โกดังสินค้า — บางนา',
    type: 'building',
    book_value: 120_000_000,
    acquisition_date: '2019-06-20',
    location: 'บางนา, กรุงเทพฯ',
    doc_no: 'NA-67890',
    appraisal_value: 145_000_000,
    appraisal_date: '2024-10-01',
  },
  // Vehicles — MCR Rental fleet
  {
    asset_no: 'FA-2024-V001',
    description: 'BMW X5 xDrive40i (MCR Rental)',
    type: 'vehicle',
    book_value: 4_500_000,
    acquisition_date: '2024-01-15',
    location: 'MCR Garage — เอกมัย',
    vreg: 'กก-1234 กรุงเทพฯ',
    vmodel: 'BMW X5 2024',
    chassis_no: 'MMF24FW020Y100001',
    appraisal_value: 4_200_000,
    appraisal_date: '2025-01-15',
  },
  {
    asset_no: 'FA-2024-V002',
    description: 'Mercedes-Benz E300 (MCR Rental)',
    type: 'vehicle',
    book_value: 3_800_000,
    acquisition_date: '2024-02-20',
    location: 'MCR Garage — เอกมัย',
    vreg: 'ขข-5678 กรุงเทพฯ',
    vmodel: 'Mercedes E300 2024',
    chassis_no: 'MBE24E300X200001',
    appraisal_value: 3_500_000,
    appraisal_date: '2025-02-01',
  },
  {
    asset_no: 'FA-2024-V003',
    description: 'BMW 320i (MCR Rental)',
    type: 'vehicle',
    book_value: 2_200_000,
    acquisition_date: '2023-08-10',
    location: 'MCR Garage — เอกมัย',
    vreg: 'งง-9999 กรุงเทพฯ',
    vmodel: 'BMW 320i 2023',
    chassis_no: 'MMF23W320X300001',
    appraisal_value: 1_950_000,
    appraisal_date: '2024-12-15',
  },
  // Business assets
  {
    asset_no: 'FA-2024-E001',
    description: 'เครื่องจักรซ่อมรถ — Hoist + Diagnostic',
    type: 'equipment',
    book_value: 8_500_000,
    acquisition_date: '2022-11-05',
    location: 'MCR Garage — เอกมัย',
    registration_no: 'EQ-2022-001',
  },
];

// ─── Lookup Function ────────────────────────────────────────────────
export interface FALookupParams {
  query?: string;            // search by asset_no / description / vreg
  type?: FAType | FAType[];  // filter by type
}

export async function faLookup(params: FALookupParams = {}): Promise<FixedAsset[]> {
  console.log('🔵 [FA Stub] Lookup with params:', params);
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 200));

  let results = MOCK_FA;

  // Filter by type
  if (params.type) {
    const types = Array.isArray(params.type) ? params.type : [params.type];
    results = results.filter((f) => types.includes(f.type));
  }

  // Search by query (asset_no, description, vreg, chassis_no)
  if (params.query) {
    const q = params.query.toLowerCase().trim();
    if (q) {
      results = results.filter((f) =>
        f.asset_no.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        (f.vreg ?? '').toLowerCase().includes(q) ||
        (f.chassis_no ?? '').toLowerCase().includes(q) ||
        (f.vmodel ?? '').toLowerCase().includes(q),
      );
    }
  }

  console.log(`✅ [FA Stub] Found ${results.length} results`);
  return results;
}

// Map Collateral type → FA type filter
export function collateralToFAType(collateralType: string): FAType[] {
  switch (collateralType) {
    case 'realestate':
      return ['realestate', 'building'];
    case 'vehicle':
      return ['vehicle'];
    case 'business':
      return ['equipment', 'building', 'other'];
    default:
      return ['realestate', 'vehicle', 'building', 'equipment', 'other'];
  }
}
