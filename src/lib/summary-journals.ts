// Summary Journals — DRAFT / PROTOTYPE (Gap ข้อ 1 · โหมด Summary/lump-sum)
// ---------------------------------------------------------------------------
// สถานะ: ยังไม่ต่อเข้ากับ EOD / ปุ่ม / endpoint ใด ๆ — เป็นก้อน pure ไว้เทสต์
//        และเอาไปโชว์ MCR ดูหน้าตา output ก่อนตัดสินใจ requirement (confirm รอบ 30)
//
// หน้าที่: รับ JE รายใบ (detail) หลายใบ → คืน "ใบรวม (summary)" โดยบวกยอด
//          ของบัญชีเดียวกัน (aggregation) ตามหลักบัญชี
//
// กติกาการรวม (grouping) — สำคัญ เพราะตัดสินว่ารวมถูกหรือผิด:
//   • 1 ใบรวม ต่อ 1 subsidiary  → NetSuite บังคับ 1 journal มี subsidiary เดียว
//                                  (นี่คือ "By Company" ที่หลุดออกมาเองโดยธรรมชาติ)
//   • ภายในแต่ละ subsidiary: รวม line ที่มี key เดียวกัน = (account + dept + location
//                            + class + rpt) แล้ว SUM ยอด — มิติต่างกันรวมกันไม่ได้
//                            (จึงย้ายมิติจาก "หัว JE" ลงมาไว้ที่ "line" ในใบรวม)
//   • dr/cr: บวกแยกก่อน แล้วค่อย net เป็นข้างเดียว (กันคู่ reverse วันเดียวกัน → 0)
//
// grouping key ปรับได้ผ่าน opts.groupBy หากลูกค้าอยากได้ granularity อื่น
// (เช่น รวมข้ามแผนก / แยกตามประเภทเหตุการณ์) — default = ตามหลักบัญชีข้างบน

// ── Input: JE ที่ resolve segment แล้ว (รูปเดียวกับที่ netsuite-stub ใช้ push) ──
export interface SummaryInputLine {
  account_code: string;
  dr: number;
  cr: number;
  description?: string | null;
}

export interface SummaryInputJE {
  je_number: string;
  je_date: string;            // YYYY-MM-DD
  subsidiary: string | null;  // netsuite_subsidiary_id (null = default '1')
  department?: string | null;
  location?: string | null;
  class?: string | null;
  rpt?: string | null;        // 'In-group' | 'External' | null
  lines: SummaryInputLine[];
}

// ── Output: ใบรวมพร้อมส่ง (มิติย้ายลง line) ──
export interface SummaryJournalLine {
  account_code: string;
  debit: number;
  credit: number;
  department: string | null;
  location: string | null;
  class: string | null;
  rpt: string | null;
  memo: string;               // อ้างอิงว่ารวมมาจากบัญชีอะไร
}

export interface SummaryJournal {
  externalid: string;         // LL-SUM-<date>-<subsidiary>
  trandate: string;
  subsidiary: string;
  memo: string;               // ระบุว่ารวมมาจาก JE ใบไหนบ้าง (สอบกลับ)
  source_je_numbers: string[];// ใบต้นทางทั้งหมด (mark synced กลับ + drill-down)
  line: SummaryJournalLine[];
}

export interface BuildSummaryOptions {
  /** ฟิลด์ที่ใช้เป็น key ในการรวม line — default: บัญชี+ทุกมิติ (ถูกหลักบัญชี) */
  groupBy?: Array<'department' | 'location' | 'class' | 'rpt'>;
  /** ปัดทศนิยม (default 2 ตำแหน่ง) — กัน floating point เพี้ยน */
  round?: number;
}

const DEFAULT_GROUP_BY: Array<'department' | 'location' | 'class' | 'rpt'> = ['department', 'location', 'class', 'rpt'];

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * รวม JE รายใบหลายใบ → ใบรวม (summary) ราย subsidiary
 * pure: ไม่แตะ DB / network — input เข้า, output ออก เท่านั้น
 */
export function buildSummaryJournals(
  jes: SummaryInputJE[],
  opts: BuildSummaryOptions = {},
): SummaryJournal[] {
  const groupBy = opts.groupBy ?? DEFAULT_GROUP_BY;
  const dp = opts.round ?? 2;

  // 1) แยกตาม subsidiary ก่อน (1 ใบรวม ต่อ 1 บริษัท)
  const bySub = new Map<string, SummaryInputJE[]>();
  for (const je of jes) {
    const sub = je.subsidiary ?? '1';
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub)!.push(je);
  }

  const out: SummaryJournal[] = [];

  for (const [sub, group] of bySub) {
    // 2) รวม line ภายในบริษัทตาม key = account + มิติที่เลือก
    // เก็บ net ยอด (dr - cr) ต่อ key เพื่อ net ข้าง (คู่ reverse หักกันเอง)
    const acc = new Map<string, {
      account_code: string; department: string | null; location: string | null;
      class: string | null; rpt: string | null; net: number;
    }>();

    const jeNos: string[] = [];
    let latestDate = '';

    for (const je of group) {
      jeNos.push(je.je_number);
      if (je.je_date > latestDate) latestDate = je.je_date;
      const dim = {
        department: groupBy.includes('department') ? (je.department ?? null) : null,
        location: groupBy.includes('location') ? (je.location ?? null) : null,
        class: groupBy.includes('class') ? (je.class ?? null) : null,
        rpt: groupBy.includes('rpt') ? (je.rpt ?? null) : null,
      };
      for (const l of je.lines) {
        const key = [l.account_code, dim.department, dim.location, dim.class, dim.rpt]
          .map((x) => x ?? '∅').join('|');
        const cur = acc.get(key) ?? { account_code: l.account_code, ...dim, net: 0 };
        cur.net += (l.dr || 0) - (l.cr || 0); // net: บวก=Dr, ลบ=Cr
        acc.set(key, cur);
      }
    }

    // 3) แปลง net → debit/credit ข้างเดียว, ตัดบรรทัดที่ net=0 (คู่ reverse หักกัน)
    const line: SummaryJournalLine[] = [];
    for (const g of acc.values()) {
      const net = round(g.net, dp);
      if (net === 0) continue; // หักกันหมด — ไม่ต้องส่ง
      line.push({
        account_code: g.account_code,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
        department: g.department,
        location: g.location,
        class: g.class,
        rpt: g.rpt,
        memo: `สรุปรวม ${jeNos.length} รายการ`,
      });
    }

    // ไม่มีบรรทัดเหลือ (ทุกอย่างหักกันเป็น 0) → ไม่ต้องสร้างใบรวม
    if (line.length === 0) continue;

    out.push({
      externalid: `LL-SUM-${latestDate}-${sub}`,
      trandate: latestDate,
      subsidiary: sub,
      memo: `Summary EOD ${latestDate} · รวมจาก: ${jeNos.join(', ')}`,
      source_je_numbers: jeNos,
      line,
    });
  }

  return out;
}

/** ตรวจว่าใบรวม balance (ผลรวม Dr = ผลรวม Cr) — ใช้ก่อนส่งจริง */
export function isSummaryBalanced(j: SummaryJournal, dp = 2): boolean {
  const totDr = round(j.line.reduce((s, l) => s + l.debit, 0), dp);
  const totCr = round(j.line.reduce((s, l) => s + l.credit, 0), dp);
  return totDr === totCr;
}
