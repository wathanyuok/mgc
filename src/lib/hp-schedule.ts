// =====================================================================
//  Hire Purchase (HP) schedule — MoM Day 4 faithful
//  Reuses the loan amortization engine (equal installments, balloon, grace,
//  declining-balance daily interest) then layers HP-specific columns:
//    • VAT       = vatRate% × installment (เงินต้น+ดอก ทั้งก้อน) — per HTML totals
//    • Total Inc VAT = installment + VAT
//    • Deferred Interest Balance = ดอกเบี้ยรอตัดบัญชี (total interest − cumulative)
//    • VAT Balance              = VAT คงเหลือ (total VAT − cumulative)
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
  representativeInstallment: number;  // level installment ex-VAT
  totalPayment: number;               // ex-VAT (principal + interest)
  totalInterest: number;
  totalPrincipal: number;
  totalVat: number;
  totalIncVat: number;                // principal + interest + VAT
}

export interface HPScheduleInput {
  principal: number;            // net financed amount (vehicle price − down payment)
  annualRate: number;
  rateCards?: RateCard[];
  termMonths: number;
  installmentStart: string;
  balloon?: number;             // balloon / residual
  balloonPattern?: string | null; // with-last | after-last | before-last
  gracePeriods?: number;
  vatRate?: number;             // default 7
  payEom?: boolean;
  paymentType?: string;         // Fix Installment | Fix Principal | Grace ... (drives split)
  stepMonths?: number;          // 1 monthly / 3 quarterly / 12 yearly
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
  });

  const totalInterest = base.totalInterest;
  const totalVat = r2(base.rows.reduce((s, row) => s + (row.installment * vatRate) / 100, 0));

  let cumInt = 0;
  let cumVat = 0;
  const rows: HPScheduleRow[] = base.rows.map((row) => {
    const vat = r2((row.installment * vatRate) / 100);
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
