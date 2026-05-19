// Core Lease / HP calculations — IFRS 16 NPV, EIR, amortization schedule.
// Mirrors the logic embedded in master_agreement_v30.html (Phase 1–4 features).

export interface ScheduleInput {
  principal: number;          // financed amount or PV of lease
  annualRate: number;          // % e.g. 4.65
  termMonths: number;
  startDate: string;           // ISO yyyy-mm-dd
  paymentFreq?: 'monthly';     // future: quarterly
  balloon?: number;            // optional balloon at last period
  balloonPattern?: 'with-last' | 'after-last' | 'before-last';
  upfront?: number;            // upfront payment (Lease)
  gracePeriods?: number;       // months with no payment (Lease)
  prepaidPeriods?: number;     // prepaid months at start
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
  } = input;

  const r = annualRate / 100 / 12;
  const effectivePrincipal = principal - upfront;
  const payingPeriods = termMonths - gracePeriods - prepaidPeriods;
  const monthly = pmt(effectivePrincipal, annualRate, payingPeriods, balloon);

  const rows: ScheduleRow[] = [];
  let balance = effectivePrincipal;
  const start = new Date(startDate);

  for (let i = 1; i <= termMonths; i++) {
    const date = new Date(start);
    date.setMonth(start.getMonth() + i);
    const dateISO = date.toISOString().slice(0, 10);

    const interest = balance * r;
    let payment = 0;
    let principalPaid = 0;
    let note: string | undefined;

    if (i <= prepaidPeriods) {
      payment = monthly;
      principalPaid = payment;
      balance -= principalPaid;
      note = 'Prepaid';
    } else if (i <= prepaidPeriods + gracePeriods) {
      payment = 0;
      principalPaid = -interest; // capitalize interest during grace
      balance += interest;
      note = 'Grace';
    } else {
      payment = monthly;
      principalPaid = payment - interest;
      balance -= principalPaid;
    }

    // Apply balloon at last period
    if (i === termMonths && balloon > 0) {
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
