// =====================================================================
// Hire Purchase (HP) schedule
// Reuses the loan amortization engine (equal installments, balloon, grace,
// declining-balance daily interest) then layers HP-specific columns:
// • VAT = vatRate% × installment (เงินต้น+ดอก ทั้งก้อน) — per HTML totals
// • Total Inc VAT = installment + VAT
// • Deferred Interest Balance = ดอกเบี้ยรอตัดบัญชี (total interest − cumulative)
// • VAT Balance = VAT คงเหลือ (total VAT − cumulative)
// =====================================================================

import { buildLoanSchedule, type LoanScheduleRow } from './loan-schedule';
import type { RateCard } from '@/components/tx/RateCards';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface HPScheduleRow extends LoanScheduleRow {
  vat: number;
  totalIncVat: number;
  deferredInterestBalance: number;
  vatBalance: number;
}

export interface HPScheduleResult {
  rows: HPScheduleRow[];
  representativeInstallment: number; // level installment ex-VAT
  totalPayment: number; // ex-VAT (principal + interest)
  totalInterest: number;
  totalPrincipal: number;
  totalVat: number;
  totalIncVat: number; // principal + interest + VAT
}

export interface HPScheduleInput {
  principal: number; // net financed amount (vehicle price − down payment)
  annualRate: number;
  rateCards?: RateCard[];
  termMonths: number;
  installmentStart: string;
  balloon?: number; // balloon / residual
  balloonPattern?: string | null; // with-last | after-last | before-last
  gracePeriods?: number;
  vatRate?: number; // default 7
  payEom?: boolean;
  paymentType?: string; // Fix Installment | Fix Principal | Grace ... (drives split)
  stepMonths?: number; // 1 monthly / 3 quarterly / 12 yearly
  paymentTiming?: 'arrears' | 'advance'; // ปลายงวด (default) | ต้นงวด
  interestBasis?: 'daily' | 'monthly'; // วิธีคิดดอก · HP default monthly (MoM 09/10)
  stepPhases?: { fromPeriod: number; installment: number }[]; // Step Payment หลายช่วง
}

export function buildHPSchedule(input: HPScheduleInput): HPScheduleResult {
  const vatRate = input.vatRate ?? 7;
  // map lease balloon pattern → the option strings the loan engine understands
  const balloonOption =
    input.balloonPattern === 'after-last' ? 'หลัง Term'
      : input.balloonPattern === 'before-last' ? 'ก่อน Term'
        : 'พร้อมค่างวด';

  const base = buildLoanSchedule({
    principal: input.principal,
    rateCards: input.rateCards ?? [],
    fallbackRate: input.annualRate,
    termMonths: input.termMonths,
    installmentStart: input.installmentStart,
    paymentType: input.paymentType ?? 'Fix Installment',
    residualValue: input.balloon ?? 0,
    balloonOption,
    includeRvInInstallment: true,
    payEom: input.payEom ?? true,
    gracePeriods: input.gracePeriods ?? 0,
    stepMonths: input.stepMonths ?? 1,
    paymentTiming: input.paymentTiming ?? 'arrears',
    interestBasis: input.interestBasis ?? 'monthly', // HP default = monthly (actual/365 ต้องเลือกเอง)
    stepPhases: input.stepPhases,
  });

  const totalInterest = base.totalInterest;
  const totalVat = r2(base.rows.reduce((s, row) => s + (row.installment * vatRate) / 100, 0));

  let cumInt = 0;
  let cumVat = 0;
  const rows: HPScheduleRow[] = base.rows.map((row, i) => {
    // งวดสุดท้ายดูดเศษปัดเศษ VAT ไว้ ไม่งั้น VAT Balance ค้าง ~0.x ที่งวดท้าย
    // (totalVat ปัดจากผลรวม · cumVat รวมค่าที่ปัดรายงวด → คลาดกันเล็กน้อย)
    const isLast = i === base.rows.length - 1;
    const vat = isLast ? r2(totalVat - cumVat) : r2((row.installment * vatRate) / 100);
    cumInt += row.interest;
    cumVat += vat;
    return {
      ...row,
      vat,
      totalIncVat: r2(row.installment + vat),
      deferredInterestBalance: Math.max(0, r2(totalInterest - cumInt)),
      vatBalance: Math.max(0, r2(totalVat - cumVat)),
    };
  });

  // MoM 09/10: เพิ่ม "งวดที่ 0" = ยอดยกมา ณ วันเริ่มสัญญา (เงินต้นเริ่มต้น · ดอก/ภาษีรอตัดเต็มก้อน)
  //   installment/interest = 0 (ยังไม่จ่าย) · beginBalance = endBalance = เงินต้น · ไม่กระทบยอดรวม
  const period0: HPScheduleRow = {
    period: 0,
    startDate: input.installmentStart,
    endDate: input.installmentStart,
    coverageEndDate: input.installmentStart,
    days: 0,
    installment: 0,
    principal: 0,
    interest: 0,
    beginBalance: input.principal,
    endBalance: input.principal,
    isBalloon: false,
    note: 'ยอดยกมา · วันเริ่มสัญญา',
    vat: 0,
    totalIncVat: 0,
    deferredInterestBalance: Math.max(0, r2(totalInterest)), // ดอกรอตัดทั้งก้อน ณ วันแรก
    vatBalance: Math.max(0, r2(totalVat)),                   // VAT รอตัดทั้งก้อน ณ วันแรก
  };
  rows.unshift(period0);

  return {
    rows,
    representativeInstallment: base.representativeInstallment,
    totalPayment: base.totalPayment,
    totalInterest,
    totalPrincipal: base.totalPrincipal,
    totalVat,
    totalIncVat: r2(base.totalPayment + totalVat),
  };
}
