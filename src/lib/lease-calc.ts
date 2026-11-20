// Core Lease / HP calculations — IFRS 16 NPV, EIR, amortization schedule.
// Mirrors the logic embedded in (Phase 1–4 features).

export interface ScheduleInput {
  principal: number; // financed amount or PV of lease
  annualRate: number; // % e.g. 4.65
  termMonths: number;
  startDate: string; // ISO yyyy-mm-dd
  paymentFreq?: 'monthly'; // future: quarterly
  /**
   * เงินก้อนท้ายสัญญา — ใส่ยอดแล้วคิดรวมในงวดสุดท้ายเสมอ ตัวเลขในช่องคือสวิตช์ในตัว
   * ไม่มีรูปแบบ (พร้อม/ก่อน/หลังงวดสุดท้าย) ให้เลือก — หน้าจอจึงไม่มีช่องนั้นให้กรอก
   */
  balloon?: number;
  upfront?: number; // upfront payment (Lease)
  gracePeriods?: number; // months with no payment (Lease)
  prepaidPeriods?: number; // prepaid months at start
  /** จ่ายวันสิ้นเดือน — ถ้าไม่ระบุ ใช้วันเดียวกับวันเริ่มสัญญาของแต่ละเดือน */
  payEom?: boolean;
  /**
   * รูปแบบการชำระ — ข้อความดิบจากช่อง PAYMENT TYPE
   * ระบบมองหา 2 คำเท่านั้น
   *   "fix principal"  → เงินต้นเท่ากันทุกงวด ค่างวดรวมลดลงเรื่อยๆ
   *   ไม่มีคำนี้        → ค่างวดเท่ากันทุกงวด (แบบตั้งต้น)
   * ส่วน grace / balloon รับผ่านช่อง gracePeriods กับ balloon อยู่แล้ว
   */
  paymentType?: string;
  /** จังหวะชำระ — ปลายงวด (ตั้งต้น) หรือ ต้นงวด */
  paymentTiming?: 'arrears' | 'advance';
  /**
   * ค่าเช่าไม่เท่ากันตลอดสัญญา — ระบุเป็นช่วงงวด
   * ถ้ามีรายการนี้ ระบบจะใช้ค่าเช่าตามช่วงแทนการคำนวณค่างวดเท่ากัน
   * และคิดยอดหนี้สินตั้งต้นจากมูลค่าปัจจุบันของค่าเช่าทั้งหมด
   */
  rentSteps?: RentStep[];
  /** VAT บนค่างวด (%) — Leasing/Lease Other ค่าเช่ามี VAT 7% · 0/ไม่ระบุ = ไม่คิด */
  vatRate?: number;
  /** จำนวนเดือนต่อ 1 งวดจ่าย — 1=รายเดือน(ตั้งต้น) · 3=รายไตรมาส · 12=รายปี · step=1 ให้ผลเดิมเป๊ะ */
  stepMonths?: number;
  /**
   * balloon จ่ายหลังจบเทอม (after-last) แทนรวมในงวดสุดท้าย (with-last · ตั้งต้น)
   * true → ค่างวดตัดเหลือ balloon ค้างไว้ แล้วจ่าย balloon เป็น "งวดพิเศษ" ถัดจากงวดสุดท้าย (มีดอกอีก 1 งวด)
   * ใช้กับสัญญาเช่าที่ residual/สิทธิซื้อคืนจ่ายแยกปลายสัญญา
   */
  balloonAfterTerm?: boolean;
}

/** ค่าเช่าช่วงหนึ่ง — งวดที่ fromPeriod ถึง toPeriod จ่ายเดือนละ amount */
export interface RentStep {
  fromPeriod: number;
  toPeriod: number;
  amount: number;
}

/** ค่าเช่าของงวดที่ i ตามช่วงที่ระบุ · ไม่เข้าช่วงไหนถือว่าไม่ต้องจ่าย */
export function rentOfPeriod(steps: RentStep[], i: number): number {
  const hit = steps.find((st) => i >= st.fromPeriod && i <= st.toPeriod);
  return hit ? hit.amount : 0;
}

/**
 * มูลค่าปัจจุบันของค่าเช่าทั้งหมด — ใช้เป็นยอดหนี้สินตามสัญญาเช่า ณ วันแรก
 * คิดลดค่าเช่าแต่ละงวดกลับมาที่วันเริ่มสัญญาด้วยอัตราคิดลดรายเดือน
 *   ปลายงวด : หารด้วย (1+r) ยกกำลังงวดที่ i
 *   ต้นงวด  : งวดแรกจ่ายทันที ไม่ต้องคิดลด จึงยกกำลัง (i-1)
 */
export function npvOfRentSteps(
  steps: RentStep[],
  termMonths: number,
  annualRate: number,
  timing: 'arrears' | 'advance' = 'arrears',
): number {
  const r = annualRate / 100 / 12;
  let pv = 0;
  for (let i = 1; i <= termMonths; i++) {
    const rent = rentOfPeriod(steps, i);
    if (!rent) continue;
    const k = timing === 'advance' ? i - 1 : i;
    pv += r === 0 ? rent : rent / Math.pow(1 + r, k);
  }
  return pv;
}

export interface ScheduleRow {
  period: number;
  date: string;
  beginBalance: number;
  payment: number;
  interest: number;
  principal: number;
  endBalance: number;
  vat?: number;         // VAT บนค่างวด (Leasing) — = payment × vatRate% · 0 เมื่อไม่คิด VAT
  totalIncVat?: number; // ค่างวดรวม VAT
  note?: string;
}

/**
 * Monthly amortization PMT formula.
 * PMT = P * (r(1+r)^n) / ((1+r)^n - 1)
 */
export function pmt(principal: number, annualRate: number, n: number, fv = 0): number {
  if (n <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) return (principal - fv) / n;
  const factor = Math.pow(1 + r, n);
  return (principal * r * factor - fv * r) / (factor - 1);
}

/**
 * Present value of a stream of equal payments (used for IFRS 16 NPV).
 */
export function pv(payment: number, annualRate: number, n: number, fv = 0): number {
  const r = annualRate / 100 / 12;
  if (r === 0) return payment * n + fv;
  const factor = Math.pow(1 + r, n);
  return (payment * (1 - 1 / factor)) / r + fv / factor;
}

/**
 * Build a monthly amortization schedule.
 * Returns rows with begin / interest / principal / end balance.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const {
    principal,
    annualRate,
    termMonths,
    startDate,
    balloon = 0,
    upfront = 0,
    gracePeriods = 0,
    prepaidPeriods = 0,
    payEom = false,
    paymentType = '',
    paymentTiming = 'arrears',
    rentSteps,
    vatRate = 0,
  } = input;

  // ค่าเช่าไม่เท่ากันเป็นช่วง — ใช้ค่าเช่าที่ระบุ ไม่คำนวณค่างวดเท่ากัน
  const useSteps = Array.isArray(rentSteps) && rentSteps.length > 0;

  // จำนวนเดือนต่องวดจ่าย — 1=รายเดือน(ตั้งต้น · ให้ผลเดิมเป๊ะ) · 3=ไตรมาส · 12=รายปี
  const step = Math.max(1, Math.floor(input.stepMonths ?? 1));
  const r = (annualRate / 100 / 12) * step; // อัตราดอกต่อ "งวดจ่าย" · step=1 → รายเดือนเหมือนเดิม
  const effectivePrincipal = principal - upfront;
  // นับเป็นจำนวน "งวดจ่าย" (ไม่ใช่เดือน) — step=1 ค่าทั้งหมดเท่าของเดิม
  const nPayments = Math.max(0, Math.ceil(termMonths / step));
  const gracePayments = Math.ceil(gracePeriods / step);
  const prepaidPayments = Math.ceil(prepaidPeriods / step);
  const payingPeriods = nPayments - gracePayments - prepaidPayments;
  // รองรับทั้งคำเดิมของ Lease ("Fix Principal") และคำแบบ Loan/HP ("Fix Principle")
  const fixPrincipal = /princip(al|le)/.test(paymentType.toLowerCase());
  // ต้นงวด: จ่ายก่อนดอกเบี้ยเดินไป 1 งวด ค่างวดจึงต่ำกว่าปลายงวดเล็กน้อย
  const advance = paymentTiming === 'advance';
  // pmt คิด r = annualRate/100/12 ภายใน → ส่ง annualRate*step เพื่อให้ได้อัตราต่อ "งวดจ่าย" ที่ถูก
  const monthly = advance
    ? pmt(effectivePrincipal, annualRate * step, payingPeriods, balloon) / (1 + r)
    : pmt(effectivePrincipal, annualRate * step, payingPeriods, balloon);
  // เงินต้นเท่ากันทุกงวด — หักงวดจ่ายล่วงหน้าและงวดปลอดชำระออกก่อน
  const levelPrincipal = payingPeriods > 0
    ? (effectivePrincipal - balloon) / payingPeriods
    : 0;

  const rows: ScheduleRow[] = [];
  let balance = effectivePrincipal;
  const start = new Date(startDate);
  // EOM — ถ้าวันเริ่มไม่ใช่สิ้นเดือน (เช่น 01/11) เลื่อน offset ลง 1 งวด เพื่อให้งวด 1 ตกสิ้นเดือนของเดือนเริ่ม
  //   ไม่งั้น EOM จะข้ามเดือนแรกไปเริ่มสิ้นเดือนถัดไป (เดือนแรกหาย) · ดอกเบี้ย lease flat รายเดือน ไม่อิงวัน จึงไม่กระทบยอด
  const startLastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const eomShift = (payEom && start.getDate() !== startLastDay) ? 1 : 0;

  for (let p = 1; p <= nPayments; p++) {
    // ระยะห่างจากวันเริ่มสัญญาเป็น "เดือน" = งวดที่ p × จำนวนเดือนต่องวด · step=1 → p (เหมือนเดิม)
    const monthOffset = p * step;
    // Month arithmetic with day-clamp so short months don't overflow
    // (e.g. a 31st start lands on Feb 28/29, not spill into March).
    const mi = start.getMonth() + monthOffset - eomShift;
    const ty = start.getFullYear() + Math.floor(mi / 12);
    const tm = ((mi % 12) + 12) % 12;
    const lastDay = new Date(ty, tm + 1, 0).getDate();
    // จ่ายวันสิ้นเดือน → ใช้วันสุดท้ายของเดือนนั้น · ไม่งั้นใช้วันเดียวกับวันเริ่มสัญญา
    const date = new Date(ty, tm, payEom ? lastDay : Math.min(start.getDate(), lastDay));
    // Local-timezone-safe ISO (YYYY-MM-DD) — avoids UTC off-by-one shift.
    const dateISO = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // ช่วงปลอดชำระอยู่ต้นสัญญา · งวดจ่ายล่วงหน้าคือ N งวดท้ายที่จ่ายไปแล้วตั้งแต่วันแรก
    const inGrace = p <= gracePayments;
    const isPrepaid = p > nPayments - prepaidPayments;
    // ต้นงวดแรกยังไม่มีเวลาให้ดอกเบี้ยเดิน · ช่วงปลอดชำระและงวดที่จ่ายล่วงหน้าไม่คิดดอกเบี้ย
    const interest = (inGrace || isPrepaid || (advance && p === 1)) ? 0 : balance * r;
    let payment = 0;
    let principalPaid = 0;
    let note: string | undefined;

    if (isPrepaid) {
      // จ่ายไปแล้วตั้งแต่วันแรก — ไม่มีภาระต้องจ่ายในอนาคต จึงไม่อยู่ในยอดหนี้สิน
      payment = 0;
      principalPaid = 0;
      note = 'Prepaid (จ่ายแล้ววันแรก)';
    } else if (inGrace) {
      // ช่วงปลอดชำระ — ไม่จ่ายและไม่คิดดอกเบี้ย ตามที่ตกลงกัน
      // (ถ้าทบดอกเข้าไปในยอด ตารางจะผ่อนไม่หมด เหลือยอดค้างท้ายสัญญา)
      payment = 0;
      principalPaid = 0;
      note = 'Grace';
    } else if (useSteps) {
      // ค่าเช่าตามช่วงที่ระบุ — ส่วนที่เกินดอกเบี้ยคือการตัดยอดหนี้สิน
      // งวดที่ไม่มีช่วง Step ครอบ (เช่น ก่อนช่วงแรกที่ตั้งไว้งวด 3) → ใช้ค่างวดปกติ (PMT) · Step override เฉพาะตั้งแต่งวดที่ระบุ
      const stepAmt = rentOfPeriod(rentSteps!, p);
      payment = stepAmt > 0 ? stepAmt : monthly;
      principalPaid = payment - interest;
      balance -= principalPaid;
    } else if (fixPrincipal) {
      // เงินต้นคงที่ + ดอกเบี้ยตามยอดคงเหลือ → ค่างวดรวมลดลงทุกงวด
      principalPaid = Math.min(levelPrincipal, balance);
      payment = principalPaid + interest;
      balance -= principalPaid;
    } else {
      payment = monthly;
      principalPaid = payment - interest;
      balance -= principalPaid;
    }

    // เงินก้อนท้าย — with-last (ตั้งต้น) รวมในงวดสุดท้าย · after-last ข้าม (จ่ายงวดพิเศษหลังเทอมด้านล่าง)
    if (!input.balloonAfterTerm && p === nPayments - prepaidPayments && balloon > 0) {
      payment += balloon;
      principalPaid += balloon;
      balance -= balloon;
      note = (note ? note + ' + ' : '') + 'Balloon';
    }

    // VAT บนค่างวด (ไม่กระทบยอดตัดต้น/ดอก — คิดเพิ่มบนค่างวดเท่านั้น)
    const vat = vatRate > 0 ? Math.round(payment * vatRate) / 100 : 0;
    rows.push({
      period: p,
      date: dateISO,
      beginBalance: balance + principalPaid,
      payment,
      interest,
      principal: principalPaid,
      endBalance: Math.max(balance, 0),
      vat,
      totalIncVat: Math.round((payment + vat) * 100) / 100,
      note,
    });
  }

  // after-last: จ่าย balloon เป็นงวดพิเศษถัดจากงวดสุดท้าย · balance ที่ค้าง = balloon + ดอกอีก 1 งวด
  if (input.balloonAfterTerm && balloon > 0 && balance > 0.005) {
    const p = nPayments + 1;
    const mi = start.getMonth() + p * step;
    const ty = start.getFullYear() + Math.floor(mi / 12);
    const tm = ((mi % 12) + 12) % 12;
    const lastDay = new Date(ty, tm + 1, 0).getDate();
    const date = new Date(ty, tm, payEom ? lastDay : Math.min(start.getDate(), lastDay));
    const dateISO = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const interest = balance * r;                 // ดอกอีก 1 งวดบนยอด balloon ที่ค้าง
    const payment = balance + interest;
    const principalPaid = balance;
    const vat = vatRate > 0 ? Math.round(payment * vatRate) / 100 : 0;
    rows.push({
      period: p,
      date: dateISO,
      beginBalance: balance,
      payment,
      interest,
      principal: principalPaid,
      endBalance: 0,
      vat,
      totalIncVat: Math.round((payment + vat) * 100) / 100,
      note: 'Balloon (จ่ายปลายสัญญา)',
    });
  }
  return rows;
}

/**
 * IFRS 16 — compute lease liability (PV) from rent stream.
 */
export function leaseLiability(rentPerPeriod: number, annualRate: number, periods: number): number {
  return pv(rentPerPeriod, annualRate, periods);
}

/**
 * Effective Interest Rate (EIR) — Newton iteration on the IRR.
 * cashflows[0] is negative (disbursement); rest are positive (repayments).
 * Returns monthly rate in %; multiply by 12 for annualized.
 */
export function eir(cashflows: number[], guess = 0.01): number {
  let r = guess;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      npv += cashflows[t] / Math.pow(1 + r, t);
      if (t > 0) dnpv += (-t * cashflows[t]) / Math.pow(1 + r, t + 1);
    }
    const newR = r - npv / dnpv;
    if (Math.abs(newR - r) < 1e-9) return newR * 100;
    r = newR;
  }
  return r * 100;
}

/**
 * ปรับการปัดเศษให้ "ตารางตรวจมือได้" (round-first-then-subtract)
 *   - ดอก/ค่างวด ปัด 2 ตำแหน่ง
 *   - เงินต้นตัด (principal) = ค่างวดปัด − ดอกปัด  → ทุกแถวลบกันลงตัวบนจอ
 *   - ยอดคงเหลือ (endBalance) ไล่ลบจากเงินต้นที่ปัดแล้ว
 *   - งวดสุดท้ายปิดเศษสะสม: principal = ยอดคงเหลือก่อนหน้า → endBalance = 0 พอดี (เงินต้นรวมตรงเป๊ะ)
 *   - VAT/Total Inc VAT + ดอกเบี้ยรอตัด/ภาษีรอตัด (HP) คิดใหม่จากค่าที่ปัดแล้ว ให้สอดคล้องกัน
 * ใช้กับทั้ง Lease (field=payment) และ HP (field=installment)
 */
export function reconcileScheduleRounding<T extends Record<string, any>>(
  rows: T[],
  opts: { installmentField: 'payment' | 'installment'; vatRate?: number; recomputeHpBalances?: boolean },
): T[] {
  if (!rows || rows.length === 0) return rows;
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const instF = opts.installmentField;
  const vatRate = opts.vatRate ?? 0;
  const out = rows.map((r) => ({ ...r })) as any[];
  const n = out.length;
  let bal = r2(Number(out[0].beginBalance) || 0);

  for (let i = 0; i < n; i++) {
    const r = out[i];
    const isLast = i === n - 1;
    let inst = r2(r[instF]);
    const int = r2(r.interest);
    // เงินต้นตัดงวดนี้ = ค่างวด − ดอก (ปัดแล้ว) · งวดสุดท้ายเก็บเศษสะสมปิดยอดให้ balance=0
    let prin = isLast ? r2(bal) : r2(inst - int);
    if (isLast) inst = r2(prin + int); // ค่างวดงวดสุดท้าย = เงินต้นปิดยอด + ดอก (ให้ลบกันลงตัวด้วย)
    r[instF] = inst;
    r.interest = int;
    r.principal = prin;
    r.beginBalance = bal;
    bal = r2(bal - prin);
    r.endBalance = Math.max(0, bal);
    if (vatRate > 0) {
      r.vat = r2((inst * vatRate) / 100);
      r.totalIncVat = r2(inst + r.vat);
    }
  }

  // HP: คิดดอกเบี้ยรอตัด/ภาษีรอตัด คงเหลือ ใหม่จากค่าที่ปัดแล้ว (ปิด 0 งวดสุดท้าย)
  if (opts.recomputeHpBalances) {
    const totalInt = r2(out.reduce((s, r) => s + (Number(r.interest) || 0), 0));
    const totalVat = r2(out.reduce((s, r) => s + (Number(r.vat) || 0), 0));
    let cumInt = 0;
    let cumVat = 0;
    for (const r of out) {
      cumInt = r2(cumInt + (Number(r.interest) || 0));
      cumVat = r2(cumVat + (Number(r.vat) || 0));
      if ('deferredInterestBalance' in r) r.deferredInterestBalance = Math.max(0, r2(totalInt - cumInt));
      if ('vatBalance' in r) r.vatBalance = Math.max(0, r2(totalVat - cumVat));
    }
  }
  return out as T[];
}
