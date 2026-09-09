// Financial Segment Sync — stub (Phase 1)
// BRD §2.13.5 · BR-SEG-02 / AC-SEG-02: ดึง Master Data มิติบัญชีจาก NetSuite รายวัน
// (หรือ Admin กด manual) แล้ว upsert ลง local 4 ตาราง
//
// Phase 2 (ของจริง): GET NetSuite SuiteTalk segment masters
//   (subsidiaries / departments / locations / classes)
//   → upsert local by code · map netsuite_*_id · record ที่ถูก inactivate ใน NetSuite
//     ให้ mark active=false (ไม่ลบ — BR-SEG-03)
//
// Stub mode: ยังไม่ยิง NetSuite จริง (รอ credential) — ไม่แก้ไขข้อมูล
//            แค่ตรวจ + รายงานจำนวน record ปัจจุบัน ให้ปุ่มทดสอบได้

import { supabase } from './supabase';

export interface SegmentSyncResult {
  inserted: number;
  updated: number;
  skipped: number;
}

const SEGMENT_TABLES = ['subsidiaries', 'departments', 'locations', 'classes'] as const;

export async function syncSegmentsFromNetSuite(): Promise<SegmentSyncResult> {
  // จำลอง network latency
  await new Promise((r) => setTimeout(r, 500));

  // Stub: อ่านจำนวน record ปัจจุบันของทั้ง 4 ตาราง (ไม่แก้ไขข้อมูล)
  let skipped = 0;
  for (const t of SEGMENT_TABLES) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    skipped += count ?? 0;
  }

  // REAL implementation (เมื่อมี credential):
  // for (const t of SEGMENT_TABLES) {
  //   const rows = await fetchNetSuiteSegments(t);     // GET SuiteTalk
  //   for (const r of rows) {
  //     upsert local by code → set netsuite_*_id · active ; inactivate ที่หายไป
  //   }
  // }

  console.log('🔵 [Segment Sync Stub] ไม่มีการเปลี่ยนแปลง — รอ NetSuite credential');
  return { inserted: 0, updated: 0, skipped };
}
