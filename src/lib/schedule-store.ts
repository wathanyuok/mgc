// เก็บตารางผ่อนชำระลงฐานข้อมูล (installment_schedules)
//
// เดิมตารางผ่อนของ Floor Plan / P/N / T/R / O/D / L/C คำนวณสดตอนเปิดหน้าจอ
// ทำให้รายงานครบกำหนดชำระ · ค้างชำระ · แจ้งเตือนรายงวด ทำไม่ได้
// ไฟล์นี้เอาผลจากตัวคำนวณเดิมมาเขียนลงตารางกลาง โดยไม่แตะตรรกะการคำนวณ
//
// เรียกตอนบันทึกสัญญา — ดู syncScheduleFor() ด้านล่าง

import { supabase } from './supabase';
import { buildFPSchedule, curtailmentFromMaster } from './fp-schedule';
import { buildPNSchedule } from './pn-schedule';
import { buildLCFeeSchedule } from './lc-fee-schedule';

/** รหัสประเภทวงเงิน — ตรงกับ facility_types.code */
export type FacilityCode = 'PN' | 'FP' | 'TR' | 'OD' | 'LC' | 'LOAN' | 'LEASE' | 'LG' | 'SBLC';

export interface ScheduleRow {
  period: number;
  due_date: string;
  begin_balance?: number;
  principal?: number;
  interest?: number;
  fee?: number;
  vat?: number;
  payment?: number;
  end_balance?: number;
  curtail_days?: number | null;
  curtail_pct?: number | null;
  chassis_no?: string | null;
  note?: string | null;
}

// ── รหัสประเภทวงเงิน → id (แคชไว้ ไม่ต้องถามซ้ำ) ──
let ftCache: Map<string, string> | null = null;
async function facilityTypeId(code: FacilityCode): Promise<string | null> {
  if (!ftCache) {
    const { data } = await supabase.from('facility_types').select('id, code');
    ftCache = new Map(((data ?? []) as any[]).map((f) => [f.code, f.id]));
  }
  return ftCache.get(code) ?? null;
}

/**
 * เขียนตารางผ่อนของสัญญาหนึ่งใบ — ลบของเดิมแล้วเขียนใหม่ทั้งชุด
 * (งวดที่ชำระไปแล้วจะรักษาสถานะไว้ ไม่ถูกล้าง)
 */
export async function saveSchedule(
  code: FacilityCode,
  facilityId: string,
  contractNo: string | null,
  rows: ScheduleRow[],
): Promise<{ saved: number; error?: string }> {
  const ftId = await facilityTypeId(code);
  if (!ftId) return { saved: 0, error: `ไม่พบประเภทวงเงิน ${code}` };
  if (!facilityId) return { saved: 0, error: 'ไม่มีเลขอ้างอิงสัญญา' };

  // เก็บสถานะการชำระของเดิมไว้ก่อน — สร้างตารางใหม่แล้วจะได้ไม่หาย
  const { data: old } = await supabase
    .from('installment_schedules')
    .select('period, chassis_no, paid, paid_date, paid_amount, repayment_id, je_posted, je_id')
    .eq('facility_type_id', ftId)
    .eq('facility_id', facilityId);
  const keep = new Map(
    ((old ?? []) as any[]).map((r) => [`${r.period}|${r.chassis_no ?? ''}`, r]),
  );

  await supabase.from('installment_schedules')
    .delete().eq('facility_type_id', ftId).eq('facility_id', facilityId);

  if (rows.length === 0) return { saved: 0 };

  const payload = rows.map((r) => {
    const prev = keep.get(`${r.period}|${r.chassis_no ?? ''}`);
    return {
      facility_type_id: ftId,
      facility_id: facilityId,
      contract_no: contractNo,
      period: r.period,
      due_date: r.due_date,
      begin_balance: r.begin_balance ?? 0,
      principal: r.principal ?? 0,
      interest: r.interest ?? 0,
      fee: r.fee ?? 0,
      vat: r.vat ?? 0,
      payment: r.payment ?? ((r.principal ?? 0) + (r.interest ?? 0) + (r.fee ?? 0) + (r.vat ?? 0)),
      end_balance: r.end_balance ?? 0,
      curtail_days: r.curtail_days ?? null,
      curtail_pct: r.curtail_pct ?? null,
      chassis_no: r.chassis_no ?? null,
      note: r.note ?? null,
      // คงสถานะการชำระ/ลงบัญชีของเดิมไว้
      paid: prev?.paid ?? false,
      paid_date: prev?.paid_date ?? null,
      paid_amount: prev?.paid_amount ?? 0,
      repayment_id: prev?.repayment_id ?? null,
      je_posted: prev?.je_posted ?? false,
      je_id: prev?.je_id ?? null,
    };
  });

  const { error } = await supabase.from('installment_schedules').insert(payload);
  if (error) {
    console.warn(`[ตารางผ่อน] บันทึก ${code} ไม่สำเร็จ:`, error.message);
    return { saved: 0, error: error.message };
  }
  return { saved: payload.length };
}

/** ลบตารางผ่อนของสัญญา — ใช้ตอนลบสัญญา */
export async function deleteSchedule(code: FacilityCode, facilityId: string) {
  const ftId = await facilityTypeId(code);
  if (!ftId || !facilityId) return;
  await supabase.from('installment_schedules')
    .delete().eq('facility_type_id', ftId).eq('facility_id', facilityId);
}

// ─────────────────────────────────────────────────────────────
// แปลงผลจากตัวคำนวณเดิม → รูปแบบตารางกลาง
// ─────────────────────────────────────────────────────────────

/** Floor Plan — ตารางทยอยคืนเงินต้น (Curtailment) */
export function fpRows(
  amount: number,
  rate: number | any[],
  txDate: string,
  maturity: string,
  mode: 'bmw' | 'other',
  curtailMaster: any | null,
): ScheduleRow[] {
  const periods = buildFPSchedule(
    amount, rate, txDate, maturity, mode,
    curtailMaster ? curtailmentFromMaster(curtailMaster) : undefined,
  );
  return periods
    .filter((p) => p.period > 0)                        // งวด 0 = แถวข้อมูลรวม ไม่ใช่งวดชำระ
    .map((p) => ({
      period: p.period,
      due_date: p.endDate,
      principal: p.curtailAmount,
      interest: p.interest,
      end_balance: p.principalBalance,
      curtail_days: p.days,
      curtail_pct: p.curtailPct,
    }));
}

/** P/N — ดอกเบี้ยรายงวด คืนเงินต้นก้อนเดียวตอนครบกำหนด */
export function pnRows(
  principal: number,
  rateOrCards: any,
  txDate: string,
  maturity: string,
): ScheduleRow[] {
  const periods = buildPNSchedule(principal, rateOrCards, txDate, maturity);
  const last = periods.length - 1;
  return periods
    .filter((p) => p.period > 0)
    .map((p, i, arr) => ({
      period: p.period,
      due_date: p.dueDate || p.endDate,
      interest: p.interestPaid,
      // คืนเงินต้นทั้งก้อนงวดสุดท้าย
      principal: i === arr.length - 1 ? principal : 0,
      end_balance: p.principalBalance,
    }));
}

/** L/C — ทยอยรับรู้ค่าธรรมเนียมตามอายุเอกสาร */
export function lcRows(issueDate: string, expiryDate: string, totalFee: number): ScheduleRow[] {
  return buildLCFeeSchedule(issueDate, expiryDate, totalFee)
    .filter((r) => r.period > 0 && r.endDate)
    .map((r) => ({
      period: r.period,
      due_date: r.endDate!,
      fee: r.feeAmount,
      end_balance: r.remaining,
    }));
}

/** Loan / Lease — คัดลอกจากตารางที่เก็บอยู่แล้ว ไม่ต้องคำนวณใหม่ */
export async function copyFromExisting(
  code: 'LOAN' | 'LEASE',
  facilityId: string,
  contractNo: string | null,
): Promise<{ saved: number; error?: string }> {
  const table = code === 'LOAN' ? 'loan_schedules' : 'lease_schedules';
  const idCol = code === 'LOAN' ? 'loan_id' : 'lease_id';
  const { data, error } = await supabase
    .from(table).select('*').eq(idCol, facilityId).order('period');
  if (error) return { saved: 0, error: error.message };

  const rows: ScheduleRow[] = ((data ?? []) as any[]).map((r) => ({
    period: r.period,
    due_date: r.due_date,
    begin_balance: Number(r.begin_balance ?? 0),
    principal: Number(r.principal ?? 0),
    interest: Number(r.interest ?? 0),
    vat: Number(r.vat ?? 0),
    payment: Number(r.total_inc_vat ?? r.payment ?? 0),
    end_balance: Number(r.end_balance ?? 0),
  }));
  return saveSchedule(code, facilityId, contractNo, rows);
}

/** ทำเครื่องหมายว่างวดนี้ชำระแล้ว — เรียกตอนบันทึกการชำระเงิน */
export async function markPaid(
  code: FacilityCode,
  facilityId: string,
  period: number,
  payDate: string,
  amount: number,
  repaymentId?: string,
) {
  const ftId = await facilityTypeId(code);
  if (!ftId) return;
  await supabase.from('installment_schedules')
    .update({ paid: true, paid_date: payDate, paid_amount: amount, repayment_id: repaymentId ?? null })
    .eq('facility_type_id', ftId).eq('facility_id', facilityId).eq('period', period);
}

// ─────────────────────────────────────────────────────────────
// สร้างตารางผ่อนจากตัวสัญญาโดยตรง — เรียกที่เดียวจบ ไม่ต้องส่งพารามิเตอร์เอง
// ใช้ตอนกด Save ในหน้าสัญญา และตอนสร้างย้อนหลังทั้งระบบ
// ─────────────────────────────────────────────────────────────

/**
 * กระจายตารางผ่อนระดับสัญญา → รายคัน ตามสัดส่วนราคารถ
 * คันสุดท้ายรับเศษที่เหลือ เพื่อให้ยอดรวมรายคันเท่ากับยอดสัญญาพอดี (ไม่มีบาทหาย)
 */
function splitByVehicle(
  rows: ScheduleRow[],
  cars: { chassis_no: string; amount?: number | null }[],
): ScheduleRow[] {
  const total = cars.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  // ไม่มีราคารถ → หารเท่ากันทุกคัน
  const share = (c: any) => (total > 0 ? Number(c.amount ?? 0) / total : 1 / cars.length);

  const out: ScheduleRow[] = [];
  for (const r of rows) {
    let accP = 0, accI = 0, accB = 0;
    cars.forEach((c, i) => {
      const last = i === cars.length - 1;
      const w = share(c);
      const p = last ? round2((r.principal ?? 0) - accP) : round2((r.principal ?? 0) * w);
      const it = last ? round2((r.interest ?? 0) - accI) : round2((r.interest ?? 0) * w);
      const bal = last ? round2((r.end_balance ?? 0) - accB) : round2((r.end_balance ?? 0) * w);
      accP += p; accI += it; accB += bal;
      out.push({ ...r, chassis_no: c.chassis_no, principal: p, interest: it, end_balance: bal });
    });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** อัตราดอกเบี้ยที่ใช้คำนวณ — เอาบัตรอัตราก่อน ไม่มีค่อยใช้อัตราคงที่ */
function rateOf(r: any): number | any[] {
  const cards = Array.isArray(r.rate_cards) ? r.rate_cards : [];
  if (cards.length) return cards;
  return Number(r.effective_rate ?? r.annual_rate ?? 0);
}

/**
 * สร้าง/อัปเดตตารางผ่อนของสัญญาหนึ่งใบ
 * เงียบเสมอ — ถ้าข้อมูลไม่พอจะข้ามไป ไม่ทำให้การบันทึกสัญญาล้มเหลว
 */
export async function syncScheduleFor(code: FacilityCode, facilityId: string): Promise<number> {
  if (!facilityId) return 0;
  try {
    if (code === 'LOAN' || code === 'LEASE') {
      const table = code === 'LOAN' ? 'loans' : 'leases';
      const noCol = code === 'LOAN' ? 'loan_no' : 'lease_no';
      const { data } = await supabase.from(table).select(`id, ${noCol}`).eq('id', facilityId).maybeSingle();
      const res = await copyFromExisting(code, facilityId, (data as any)?.[noCol] ?? null);
      return res.saved;
    }

    if (code === 'FP') {
      const { data: fp } = await supabase.from('floor_plans')
        .select('id, fp_no, name, amount, rate_cards, transaction_date, maturity_date, schedule_mode, curtailment_id')
        .eq('id', facilityId).maybeSingle();
      if (!fp) return 0;
      const f: any = fp;
      let master: any = null;
      if (f.curtailment_id) {
        const { data } = await supabase.from('curtailments').select('*').eq('id', f.curtailment_id).maybeSingle();
        master = data;
      }
      const contractRows = fpRows(
        Number(f.amount ?? 0), rateOf(f), f.transaction_date, f.maturity_date,
        (f.schedule_mode === 'other' ? 'other' : 'bmw'), master,
      );

      // แยกรายคัน — กระจายยอดคืนต้นและดอกเบี้ยตามสัดส่วนราคารถแต่ละคัน
      const { data: cars } = await supabase.from('fp_chassis')
        .select('chassis_no, amount').eq('fp_id', facilityId);
      const list = ((cars ?? []) as any[]).filter((c) => c.chassis_no);
      const rows = list.length > 1
        ? splitByVehicle(contractRows, list)
        : contractRows.map((r) => ({ ...r, chassis_no: list[0]?.chassis_no ?? null }));

      return (await saveSchedule('FP', facilityId, f.name ?? f.fp_no, rows)).saved;
    }

    if (code === 'PN') {
      const { data } = await supabase.from('promissory_notes')
        .select('id, pn_number, name, amount, rate_cards, effective_rate, transaction_date, maturity_date')
        .eq('id', facilityId).maybeSingle();
      if (!data) return 0;
      const r: any = data;
      const rows = pnRows(Number(r.amount ?? 0), rateOf(r), r.transaction_date, r.maturity_date);
      return (await saveSchedule('PN', facilityId, r.pn_number ?? r.name, rows)).saved;
    }

    if (code === 'TR') {
      const { data } = await supabase.from('trust_receipts')
        .select('id, tr_no, name, amount, rate_cards, effective_rate, transaction_date, maturity_date, due_date')
        .eq('id', facilityId).maybeSingle();
      if (!data) return 0;
      const r: any = data;
      const rows = pnRows(
        Number(r.amount ?? 0), rateOf(r), r.transaction_date, r.maturity_date ?? r.due_date,
      );
      return (await saveSchedule('TR', facilityId, r.tr_no ?? r.name, rows)).saved;
    }

    if (code === 'LC' || code === 'SBLC') {
      const { data } = await supabase.from('letters_of_credit')
        .select('id, lc_no, name, amount, fee_rate, transaction_date, issue_date, expiry_date')
        .eq('id', facilityId).maybeSingle();
      if (!data) return 0;
      const r: any = data;
      const totalFee = Number(r.amount ?? 0) * Number(r.fee_rate ?? 0) / 100;
      const rows = lcRows(r.issue_date ?? r.transaction_date, r.expiry_date, totalFee);
      return (await saveSchedule('LC', facilityId, r.lc_no ?? r.name, rows)).saved;
    }

    return 0;   // O/D คิดดอกเบี้ยจากยอดคงเหลือรายวัน ไม่มีตารางงวดตายตัว
  } catch (e: any) {
    console.warn(`[ตารางผ่อน] สร้างของ ${code} ไม่สำเร็จ:`, e?.message ?? e);
    return 0;
  }
}

/**
 * สร้างตารางผ่อนย้อนหลังให้สัญญาที่มีอยู่แล้วทั้งระบบ
 * ใช้ครั้งเดียวหลังเปิดใช้ตารางกลาง หรือหลังนำเข้าข้อมูลจากระบบเดิม
 */
export async function rebuildAllSchedules(
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<{ total: number; rows: number; byType: Record<string, number> }> {
  const sources: { code: FacilityCode; table: string }[] = [
    { code: 'FP', table: 'floor_plans' },
    { code: 'PN', table: 'promissory_notes' },
    { code: 'TR', table: 'trust_receipts' },
    { code: 'LC', table: 'letters_of_credit' },
    { code: 'LOAN', table: 'loans' },
    { code: 'LEASE', table: 'leases' },
  ];

  const all: { code: FacilityCode; id: string }[] = [];
  for (const s of sources) {
    const { data } = await supabase.from(s.table).select('id');
    for (const r of (data ?? []) as any[]) all.push({ code: s.code, id: r.id });
  }

  const byType: Record<string, number> = {};
  let rows = 0;
  for (let i = 0; i < all.length; i++) {
    const n = await syncScheduleFor(all[i].code, all[i].id);
    rows += n;
    byType[all[i].code] = (byType[all[i].code] ?? 0) + n;
    onProgress?.(i + 1, all.length, all[i].code);
  }
  return { total: all.length, rows, byType };
}
