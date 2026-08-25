// รายงานเลขตัวถังที่ซ้อนอยู่ในหลายวงเงิน
//
// กฎที่ตกลงกันไว้:
//   • ธนาคารเดียวกัน   → ผิดกฎ (ตอนบันทึกระบบบล็อกอยู่แล้ว — ที่หลุดมาได้คือข้อมูลนำเข้าจากระบบเดิม)
//   • ต่างธนาคาร        → ทำได้ แต่ต้องรู้ตัวและตรวจสอบ (เงินขายรถก้อนเดียวต้องคืนหลายเจ้า)
//
// ต่างจาก checkChassisConflict ตรงที่ตัวนั้นเช็คทีละคันตอนกรอกฟอร์ม
// ส่วนตัวนี้ไล่ทั้งพอร์ตย้อนหลัง เพื่อให้ Finance ตรวจสอบได้

import { supabase } from './supabase';
import { leaseRoute } from '@/lib/lease-kind';

export type OverlapModule = 'HP' | 'Lease' | 'Loan' | 'Floor Plan' | 'P/N';

export interface OverlapUse {
  module: OverlapModule;
  contractNo: string;
  status: string;
  bank: string;
  route: string;
}

export interface OverlapRow {
  chassisNo: string;
  model: string | null;
  uses: OverlapUse[];
  sameBank: boolean;      // มีอย่างน้อย 2 สัญญาที่เป็นธนาคารเดียวกัน → ผิดกฎ
  bankCount: number;
}

// สถานะที่ถือว่าสัญญา "ปิดแล้ว" — ที่เหลือถือว่ายังเปิดอยู่
// กรองฝั่งหน้าจอแทนการส่งรายชื่อสถานะไปให้ฐานข้อมูล
// เพราะถ้าส่งค่าที่ตารางยังไม่รู้จัก คำสั่งจะพังทั้งชุดและได้ผลว่างเปล่า
const CLOSED = ['closed', 'repaid', 'cancelled', 'terminated', 'rejected', 'expired', 'converted'];
const isOpen = (status: string | null | undefined) =>
  !CLOSED.includes((status ?? '').trim().toLowerCase());

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export async function getChassisOverlaps(): Promise<OverlapRow[]> {
  // เก็บทุกการใช้งานของแต่ละเลขตัวถัง
  const byChassis = new Map<string, { model: string | null; uses: OverlapUse[] }>();
  const add = (chassisNo: string, model: string | null, use: OverlapUse) => {
    const key = (chassisNo ?? '').trim();
    if (!key) return;
    const cur = byChassis.get(key) ?? { model: null, uses: [] };
    if (!cur.model && model) cur.model = model;
    cur.uses.push(use);
    byChassis.set(key, cur);
  };

  // ── 1) HP + Lease (เก็บเลขตัวถังไว้ในตัวสัญญาเอง) ──
  // ดึงธนาคารจากวงเงินแยกอีกรอบ แทนการ join ข้ามตาราง — กันกรณี join พลาดแล้วข้อมูลหายเงียบ
  const { data: leases, error: leaseErr } = await supabase
    .from('leases')
    .select('id, lease_no, mode, chassis_no, asset_name, status, ca_id')
    .not('chassis_no', 'is', null);
  if (leaseErr) console.warn('[รถค้ำซ้ำวงเงิน] อ่านสัญญาเช่าไม่สำเร็จ:', leaseErr.message);

  const caIds = [...new Set(((leases ?? []) as any[]).map((l) => l.ca_id).filter(Boolean))];
  const caBank = new Map<string, string>();
  if (caIds.length) {
    const { data: cas } = await supabase
      .from('credit_agreements').select('id, finance_institution').in('id', caIds);
    for (const ca of (cas ?? []) as any[]) caBank.set(ca.id, ca.finance_institution ?? '');
  }

  for (const l of (leases ?? []) as any[]) {
    if (!isOpen(l.status)) continue;
    add(l.chassis_no, l.asset_name ?? null, {
      module: l.mode === 'hp' ? 'HP' : 'Lease',
      contractNo: l.lease_no ?? String(l.id).slice(0, 8),
      status: l.status,
      bank: (l.ca_id ? caBank.get(l.ca_id) : '') || '—',
      route: leaseRoute(l.mode, l.id),
    });
  }

  // ── 2) Loan (ตารางลูกแยก) ──
  const { data: loanCh, error: loanErr } = await supabase.from('loan_chassis').select('chassis_no, car_model, loan_id');
  if (loanErr) console.warn('[รถค้ำซ้ำวงเงิน] อ่านรถใน Loan ไม่สำเร็จ:', loanErr.message);
  const loanIds = [...new Set(((loanCh ?? []) as any[]).map((r) => r.loan_id).filter(Boolean))];
  if (loanIds.length) {
    const { data: loans } = await supabase
      .from('loans').select('id, loan_no, status, finance_institution')
      .in('id', loanIds);
    const map = new Map(((loans ?? []) as any[]).map((r) => [r.id, r]));
    for (const c of (loanCh ?? []) as any[]) {
      const loan = map.get(c.loan_id);
      if (!loan || !isOpen(loan.status)) continue;
      add(c.chassis_no, c.car_model ?? null, {
        module: 'Loan', contractNo: loan.loan_no ?? String(loan.id).slice(0, 8),
        status: loan.status, bank: loan.finance_institution ?? '—', route: `/tx/loan/${loan.id}`,
      });
    }
  }

  // ── 3) Floor Plan (ตารางลูกแยก) ──
  const { data: fpCh, error: fpErr } = await supabase.from('fp_chassis').select('chassis_no, model, fp_id');
  if (fpErr) console.warn('[รถค้ำซ้ำวงเงิน] อ่านรถใน Floor Plan ไม่สำเร็จ:', fpErr.message);
  const fpIds = [...new Set(((fpCh ?? []) as any[]).map((r) => r.fp_id).filter(Boolean))];
  if (fpIds.length) {
    const { data: fps } = await supabase
      .from('floor_plans').select('id, fp_no, status, finance_institution')
      .in('id', fpIds);
    const map = new Map(((fps ?? []) as any[]).map((r) => [r.id, r]));
    for (const c of (fpCh ?? []) as any[]) {
      const fp = map.get(c.fp_id);
      if (!fp || !isOpen(fp.status)) continue;
      add(c.chassis_no, c.model ?? null, {
        module: 'Floor Plan', contractNo: fp.fp_no ?? String(fp.id).slice(0, 8),
        status: fp.status, bank: fp.finance_institution ?? '—', route: `/tx/fp/${fp.id}`,
      });
    }
  }

  // ── 4) P/N (เก็บเป็นรายการอยู่ในตัวสัญญา) ──
  const { data: pns, error: pnErr } = await supabase
    .from('promissory_notes')
    .select('id, name, pn_number, status, chassis_list, finance_institution');
  if (pnErr) console.warn('[รถค้ำซ้ำวงเงิน] อ่าน P/N ไม่สำเร็จ:', pnErr.message);
  for (const pn of (pns ?? []) as any[]) {
    if (!isOpen(pn.status)) continue;
    const list = Array.isArray(pn.chassis_list) ? pn.chassis_list : [];
    for (const c of list) {
      if (!c?.chassis_no) continue;
      add(c.chassis_no, c.model ?? c.car_model ?? null, {
        module: 'P/N', contractNo: pn.pn_number ?? pn.name ?? String(pn.id).slice(0, 8),
        status: pn.status, bank: pn.finance_institution ?? '—', route: `/tx/pn/${pn.id}`,
      });
    }
  }

  // สรุปให้เห็นว่าแต่ละคันอยู่ในกี่สัญญา — ถ้าทุกคันอยู่สัญญาเดียว แปลว่าไม่มีการซ้อนจริง
  const perChassis = [...byChassis.entries()].map(([no, v]) => ({
    เลขตัวถัง: no,
    จำนวนสัญญา: new Set(v.uses.map((u) => `${u.module}|${u.contractNo}`)).size,
    อยู่ที่: [...new Set(v.uses.map((u) => `${u.module} ${u.contractNo}`))].join(' · '),
  }));
  console.log('[รถค้ำซ้ำวงเงิน] เลขตัวถังที่พบ', byChassis.size, 'คัน');
  console.table(perChassis);

  // ── สรุปเฉพาะคันที่อยู่มากกว่า 1 สัญญา ──
  const rows: OverlapRow[] = [];
  for (const [chassisNo, v] of byChassis) {
    // สัญญาใบเดียวอาจบันทึกรถคันเดิมหลายแถว — นับเป็นสัญญาเดียว ไม่ใช่การซ้อนวงเงิน
    const seen = new Set<string>();
    const uses = v.uses.filter((u) => {
      const key = `${u.module}|${u.contractNo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (uses.length < 2) continue;

    const banks = uses.map((u) => norm(u.bank)).filter(Boolean);
    const sameBank = banks.some((b, i) => banks.indexOf(b) !== i); // มีธนาคารซ้ำ
    rows.push({
      chassisNo,
      model: v.model,
      uses,
      sameBank,
      bankCount: new Set(banks).size,
    });
  }

  // ผิดกฎขึ้นก่อน แล้วเรียงตามจำนวนสัญญาที่ซ้อน
  return rows.sort((a, b) =>
    Number(b.sameBank) - Number(a.sameBank) || b.uses.length - a.uses.length,
  );
}
