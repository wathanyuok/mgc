// ตีราคาสัญญาซื้อขายเงินตราล่วงหน้า ณ สิ้นงวด (Mark-to-Market)
//
// ณ สิ้นเดือนต้องตีราคาสัญญาที่ยังไม่ครบกำหนด แล้วลงกำไร/ขาดทุนที่ยังไม่เกิดขึ้นจริงเข้าสมุดบัญชี
//
// ผลต่าง (บาท) = จำนวนเงินสกุลต่างประเทศ × (อัตราสิ้นงวด − อัตราตามสัญญา)
//
// ไฟล์นี้เป็น "ทางเดียว" ของการตีราคาทั้งระบบ — ทั้งปุ่มในหน้ารายละเอียดและปุ่มลงบัญชี
// ทั้งพอร์ตในหน้ารายการเรียกผ่านที่นี่ เพื่อให้ใช้ผังบัญชีชุดเดียวกันและกันการลงซ้ำจุดเดียว
// (เดิมมีสองชุดที่ไม่รู้จักกัน สัญญาเดียวเดือนเดียวจึงได้กำไร/ขาดทุนซ้ำสองชุด คนละ 4 บัญชี)

import { supabase } from './supabase';
import { createJE, postJE } from './je';
import type { FXForward, FXValuation } from '@/types/database';

/** ใบผูกบัญชีในแท็บผังบัญชีของสัญญา — เก็บเป็น "รหัส ชื่อบัญชี" */
export interface FxAcctCard {
  type?: string;
  gl?: string;
}

/**
 * ผังบัญชีตั้งต้นของการตีราคาสัญญาซื้อขายเงินตราล่วงหน้า
 *
 * ทำไมต้องเปลี่ยนรหัสทั้งชุด: ของเดิม (119500 / 219500 / 710020 / 610020) ไม่มีอยู่จริง
 * ในผังบัญชีของบริษัท (ตาราง gl_accounts) ใบสำคัญที่ลงด้วยรหัสเหล่านั้นจะถูกปฏิเสธ
 * ตอนส่งเข้าระบบบัญชีปลายทาง · ชุดนี้เลือกจากรหัสที่มีอยู่จริงทั้งหมด
 */
export const FX_VALUATION_GL = {
  // ผังบัญชียังไม่มีบัญชี "สินทรัพย์ตราสารอนุพันธ์" แยกไว้ จึงพักไว้ที่สินทรัพย์หมุนเวียนอื่น
  // ถ้าภายหลังเปิดบัญชีเฉพาะ ให้ผูกทับได้ที่แท็บผังบัญชีของสัญญา (ไม่ต้องแก้โค้ด)
  fxfAsset:     { code: '1191999', name: 'สินทรัพย์หมุนเวียนอื่น-อื่น' },
  fxfLiab:      { code: '2391101', name: 'หนี้สินตราสารอนุพันธ์ - Current portion' },
  fxGainUnreal: { code: '4929103', name: 'กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา' },
  fxLossUnreal: { code: '5439907', name: 'ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา' },
};

/** แยกข้อความ "รหัส ชื่อบัญชี" ที่ผู้ใช้เลือกไว้ ออกเป็นรหัสกับชื่อ */
function splitGL(raw: string): { code: string; name: string } {
  const sp = raw.indexOf(' ');
  return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
}

/** หยิบบัญชีตามหน้าที่ที่ผูกไว้ในแท็บผังบัญชี ถ้าไม่ได้ผูกจึงใช้ค่าตั้งต้น */
export function pickAcctCard(
  cards: FxAcctCard[] | null | undefined,
  acctType: string,
  fallback: { code: string; name: string },
): { code: string; name: string } {
  const hit = (cards ?? []).find((c) => c.type === acctType && (c.gl ?? '').trim());
  return hit ? splitGL(hit.gl!.trim()) : fallback;
}

/**
 * ผังบัญชีที่ใบสำคัญตีราคาของสัญญาใบนี้จะใช้จริง
 * อ่านจากแท็บผังบัญชีของสัญญาก่อน ถ้าไม่ได้ผูกไว้จึงตกไปใช้ค่าตั้งต้น
 *
 * หมายเหตุ: หน้าที่บัญชีในแท็บผังบัญชีเป็นรายการกลางของทั้งระบบ ยังไม่มีหัวข้อ
 * "สินทรัพย์/หนี้สินตราสารอนุพันธ์" โดยเฉพาะ จึงยืมหัวข้อที่ใกล้เคียงที่สุดมาใช้
 */
export function resolveFXValuationGL(cards?: FxAcctCard[] | null) {
  return {
    fxfAsset:     pickAcctCard(cards, 'OTHER ACCOUNT', FX_VALUATION_GL.fxfAsset),
    fxfLiab:      pickAcctCard(cards, 'NOTE PAYABLE ACCOUNT', FX_VALUATION_GL.fxfLiab),
    fxGainUnreal: pickAcctCard(cards, 'UNREALIZED GAIN/LOSS ACCOUNT', FX_VALUATION_GL.fxGainUnreal),
    fxLossUnreal: pickAcctCard(cards, 'UNREALIZED GAIN/LOSS ACCOUNT', FX_VALUATION_GL.fxLossUnreal),
  };
}

export interface MTMResult {
  notional_thb: number;
  mtm_thb: number;
}

/**
 * คำนวณผลต่างจากการตีราคาของสัญญาหนึ่งใบ ณ อัตราสิ้นงวดที่กำหนด
 *
 * ยอดตามสัญญา (บาท) = จำนวนเงินสกุลต่างประเทศ × อัตราตามสัญญา
 * ผลต่าง (บาท)      = จำนวนเงินสกุลต่างประเทศ × (อัตราสิ้นงวด − อัตราตามสัญญา)
 *                     บวก = กำไรที่ยังไม่เกิดขึ้นจริง · ลบ = ขาดทุนที่ยังไม่เกิดขึ้นจริง
 *
 * สัญญาฝั่งขายให้ผลกลับด้าน — ขายไว้ที่อัตราสูงกว่าตลาดคือกำไร
 */
export function computeMTM(
  fxf: Pick<FXForward, 'notional_amount_foreign' | 'amount_buy' | 'forward_rate' | 'direction'>,
  monthEndRate: number,
  _valuationDate: string,
): MTMResult {
  const notional = Number(fxf.notional_amount_foreign ?? fxf.amount_buy ?? 0);
  const contractRate = Number(fxf.forward_rate ?? 0);
  const monthEnd = Number(monthEndRate ?? 0);

  const notional_thb = round2(notional * contractRate);
  let mtm_thb = round2(notional * (monthEnd - contractRate));
  if (fxf.direction === 'Sell') mtm_thb = -mtm_thb;
  return { notional_thb, mtm_thb };
}

/** Find FX Forwards eligible for valuation on `asOfDate` (Active + not yet settled). */
export async function findActiveForValuation(asOfDate: string): Promise<FXForward[]> {
  const { data, error } = await supabase
    .from('fx_forwards')
    .select('*')
    .eq('status', 'Active')
    .gte('value_date', asOfDate)
    .order('fxf_no');
  if (error) throw error;
  return (data ?? []) as FXForward[];
}

/** งวดบัญชีของการตีราคา — ปีเดือนแบบตัวเลข เช่น 2026-08-31 → 202608 */
export function valuationPeriod(dateISO: string): number {
  const d = new Date(dateISO);
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

/** วันที่ 1 ของเดือนถัดไป — วันที่ที่ใช้กลับรายการตีราคา */
export function nextMonthFirstDay(dateISO: string): string {
  const d = new Date(dateISO);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * กันลงบัญชีตีราคาซ้ำงวดเดิม
 *
 * เดิมกดปุ่มกี่ครั้งก็ได้ใบสำคัญใหม่ทุกครั้ง งวดเดียวจึงมีได้หลายใบ
 * ตรวจจากใบสำคัญที่ลงไปแล้วโดยตรง (ไม่นับใบกลับรายการ) — เชื่อถือได้กว่าค่าบนหน้าจอ
 */
export async function assertNoValuationJE(fxfId: string, period: number): Promise<void> {
  const { data } = await supabase
    .from('journal_entries')
    .select('je_number')
    .eq('source_type', 'FX_VALUATION')
    .eq('source_id', fxfId)
    .eq('source_period', period)
    .eq('status', 'Posted')
    .eq('is_reversal', false);
  if (data && data.length > 0) {
    throw new Error(
      `งวดนี้ลงบัญชีตีราคาไปแล้ว — ใบสำคัญเลขที่ ${data[0].je_number} · ถ้าต้องแก้ ให้กลับรายการใบเดิมก่อน`,
    );
  }
}

/**
 * ลงบัญชีตีราคาหนึ่งงวดของสัญญาหนึ่งใบ แล้วผูกเลขใบสำคัญกลับเข้าแถวการตีราคา
 * ผู้เรียกต้องแทรกแถวการตีราคา (status='Draft') มาก่อน
 *
 * ใบสำคัญ:
 *   ผลต่าง > 0 → Dr สินทรัพย์ตราสารอนุพันธ์ / Cr กำไรจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง
 *   ผลต่าง < 0 → Dr ขาดทุนจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง / Cr หนี้สินตราสารอนุพันธ์
 *   ผลต่าง ≈ 0 → ไม่ต้องลงบัญชี (คืนค่า null)
 *
 * และลง "ใบกลับรายการ" ลงวันที่ 1 ของเดือนถัดไปให้พร้อมกันเสมอ
 * เพราะการตีราคาเป็นรายการปรับปรุง ณ สิ้นงวด ต้องกลับออกเมื่อขึ้นงวดใหม่
 * (เดิมระบบเขียนบนหน้าจอว่ากลับรายการให้อัตโนมัติ แต่กลับให้เฉพาะตอนกดปิดสัญญาเท่านั้น)
 */
export async function postFXValuationJE(
  valuation: FXValuation,
  fxfNo: string,
  cards?: FxAcctCard[] | null,
): Promise<string | null> {
  const amt = Math.abs(round2(valuation.mtm_thb));
  if (amt < 0.005) return null;

  const GL = resolveFXValuationGL(cards);
  const period = valuationPeriod(valuation.valuation_date);
  const isGain = valuation.mtm_thb > 0;
  const lines = isGain
    ? [
        { account_code: GL.fxfAsset.code,     account_name: GL.fxfAsset.name,     dr: amt, description: `ตีราคาสัญญา ${fxfNo} ณ อัตรา ${valuation.month_end_rate}` },
        { account_code: GL.fxGainUnreal.code, account_name: GL.fxGainUnreal.name, cr: amt, description: `กำไรจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง — ${fxfNo}` },
      ]
    : [
        { account_code: GL.fxLossUnreal.code, account_name: GL.fxLossUnreal.name, dr: amt, description: `ขาดทุนจากอัตราแลกเปลี่ยนที่ยังไม่เกิดขึ้นจริง — ${fxfNo}` },
        { account_code: GL.fxfLiab.code,      account_name: GL.fxfLiab.name,      cr: amt, description: `ตีราคาสัญญา ${fxfNo} ณ อัตรา ${valuation.month_end_rate}` },
      ];

  // อัตราสิ้นงวดที่ใช้ตีราคาต้องย้อนกลับไปตรวจได้ จึงเขียนไว้ในหมายเหตุของใบสำคัญด้วย
  // (นอกจากเก็บไว้ที่แถวการตีราคาแล้ว)
  const rateNote =
    `${isGain ? 'กำไร' : 'ขาดทุน'}จากการตีราคา ${amt.toFixed(2)} บาท · ` +
    `จำนวนเงิน ${valuation.notional_amount} × (อัตราสิ้นงวด ${valuation.month_end_rate} − อัตราตามสัญญา ${valuation.contract_rate})`;

  const je = await createJE({
    source_type: 'FX_VALUATION',
    // ผูกกับตัวสัญญาโดยตรง เพื่อให้ค้นใบสำคัญจากเลขที่สัญญาได้ และตรวจซ้ำงวดได้ด้วย source_period
    source_id: valuation.fxf_id,
    source_period: period,
    je_date: valuation.valuation_date,
    description: `ตีราคาสัญญาซื้อขายเงินตราล่วงหน้า — ${fxfNo} (${valuation.valuation_date})`,
    remark: rateNote,
    lines,
  });
  await postJE(je.id, 'user');

  // ใบกลับรายการต้นเดือนถัดไป — ลงพร้อมกันเพื่อไม่ให้ค้างข้ามงวด
  const reverseDate = nextMonthFirstDay(valuation.valuation_date);
  const reverse = await createJE({
    source_type: 'FX_VALUATION',
    source_id: valuation.fxf_id,
    source_period: period,
    je_date: reverseDate,
    description: `กลับรายการตีราคา — ${fxfNo} (ของงวด ${valuation.valuation_date})`,
    remark: `กลับรายการใบสำคัญ ${je.je_number} · ${rateNote}`,
    lines: lines.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name,
      dr: l.cr ?? 0,
      cr: l.dr ?? 0,
      description: `กลับรายการ: ${l.description}`,
    })),
  });
  await supabase
    .from('journal_entries')
    .update({
      is_reversal: true,
      status: 'Posted',
      posted_by: 'user',
      posted_at: new Date().toISOString(),
    })
    .eq('id', reverse.id);
  // ผูกใบต้นเรื่องกับใบกลับรายการ แต่ไม่เปลี่ยนสถานะใบต้นเรื่อง
  // เพราะใบต้นเรื่องยังมีผลอยู่จนถึงสิ้นงวด — ใบกลับรายการเพิ่งมีผลเดือนถัดไป
  await supabase
    .from('journal_entries')
    .update({ reversed_by_je_id: reverse.id })
    .eq('id', je.id);

  await supabase
    .from('fx_valuations')
    .update({
      je_id: je.id,
      status: 'Posted',
      remark: `ใบสำคัญ ${je.je_number} · กลับรายการ ${reverse.je_number} วันที่ ${reverseDate}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', valuation.id);

  return je.je_number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
