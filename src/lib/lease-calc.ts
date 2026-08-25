// Core Lease / HP calculations — IFRS 16 NPV, EIR, amortization schedule.
// Mirrors the logic embedded in (Phase 1–4 features).

export interface ScheduleInput {
  principal: number; // financed amount or PV of lease
  annualRate: number; // % e.g. 4.65
  termMonths: number;
  startDate: string; // ISO yyyy-mm-dd
  paymentFreq?: 'monthly'; // future: quarterly
  balloon?: number; // optional balloon at last period
  balloonPattern?: 'with-last' | 'after-last' | 'before-last';
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
  } = input;

  // ค่าเช่าไม่เท่ากันเป็นช่วง — ใช้ค่าเช่าที่ระบุ ไม่คำนวณค่างวดเท่ากัน
  const useSteps = Array.isArray(rentSteps) && rentSteps.length > 0;

  const r = annualRate / 100 / 12;
  const effectivePrincipal = principal - upfront;
  const payingPeriods = termMonths - gracePeriods - prepaidPeriods;
  const fixPrincipal = paymentType.toLowerCase().includes('fix principal');
  // ต้นงวด: จ่ายก่อนดอกเบี้ยเดินไป 1 งวด ค่างวดจึงต่ำกว่าปลายงวดเล็กน้อย
  const advance = paymentTiming === 'advance';
  const monthly = advance
    ? pmt(effectivePrincipal, annualRate, payingPeriods, balloon) / (1 + r)
    : pmt(effectivePrincipal, annualRate, payingPeriods, balloon);
  // เงินต้นเท่ากันทุกงวด — หักงวดจ่ายล่วงหน้าและงวดปลอดชำระออกก่อน
  const levelPrincipal = payingPeriods > 0
    ? (effectivePrincipal - balloon) / payingPeriods
    : 0;

  const rows: ScheduleRow[] = [];
  let balance = effectivePrincipal;
  const start = new Date(startDate);

  for (let i = 1; i <= termMonths; i++) {
    // Month arithmetic with day-clamp so short months don't overflow
    // (e.g. a 31st start lands on Feb 28/29, not spill into March).
    const mi = start.getMonth() + i;
    const ty = start.getFullYear() + Math.floor(mi / 12);
    const tm = ((mi % 12) + 12) % 12;
    const lastDay = new Date(ty, tm + 1, 0).getDate();
    // จ่ายวันสิ้นเดือน → ใช้วันสุดท้ายของเดือนนั้น · ไม่งั้นใช้วันเดียวกับวันเริ่มสัญญา
    const date = new Date(ty, tm, payEom ? lastDay : Math.min(start.getDate(), lastDay));
    // Local-timezone-safe ISO (YYYY-MM-DD) — avoids UTC off-by-one shift.
    const dateISO = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // ช่วงปลอดชำระอยู่ต้นสัญญา · งวดจ่ายล่วงหน้าคือ N งวดท้ายที่จ่ายไปแล้วตั้งแต่วันแรก
    const inGrace = i <= gracePeriods;
    const isPrepaid = i > termMonths - prepaidPeriods;
    // ต้นงวดแรกยังไม่มีเวลาให้ดอกเบี้ยเดิน · ช่วงปลอดชำระและงวดที่จ่ายล่วงหน้าไม่คิดดอกเบี้ย
    const interest = (inGrace || isPrepaid || (advance && i === 1)) ? 0 : balance * r;
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
      payment = rentOfPeriod(rentSteps!, i);
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

    // Apply balloon at last period
    if (i === termMonths - prepaidPeriods && balloon > 0) {
      payment += balloon;
      principalPaid += balloon;
      balance -= balloon;
      note = (note ? note + ' + ' : '') + 'Balloon';
    }

    rows.push({
      period: i,
      date: dateISO,
      beginBalance: balance + principalPaid,
      payment,
      interest,
      principal: principalPaid,
      endBalance: Math.max(balance, 0),
      note,
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
