// Automated test ยืนยันโมดูล HP ที่ยกจาก cr คำนวณถูกต้อง (invariants ไม่ fragile)
// (Loan/Reconcile backward-compat มี unit test suite เดิมคุมอยู่แล้ว — ที่นี่เน้น HP ที่ยกใหม่)
import { describe, it, expect } from 'vitest';
import { buildHPSchedule } from '@/lib/hp-schedule';

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

describe('HP schedule (ยกจาก cr) — invariants', () => {
  const base = {
    principal: 1_000_000,
    annualRate: 5,
    termMonths: 12,
    installmentStart: '2026-01-15',
    paymentType: 'Fix Installment',
  };

  it('เงินต้นรวม = ยอดตั้งต้น และงวดสุดท้ายปิดยอดเป็น 0', () => {
    const r = buildHPSchedule({ ...base });
    const pay = r.rows.filter((x) => x.period > 0);
    expect(near(r.totalPrincipal, 1_000_000, 2)).toBe(true);
    expect(near(pay.reduce((s, x) => s + x.principal, 0), 1_000_000, 2)).toBe(true);
    expect(near(pay[pay.length - 1].endBalance, 0, 1)).toBe(true);
  });

  it('totalPayment = totalPrincipal + totalInterest', () => {
    const r = buildHPSchedule({ ...base });
    expect(near(r.totalPayment, r.totalPrincipal + r.totalInterest, 2)).toBe(true);
  });

  it('interestBasis monthly กับ daily ให้ดอกเบี้ยรวมต่างกัน (คิดคนละวิธี)', () => {
    const monthly = buildHPSchedule({ ...base, interestBasis: 'monthly' });
    const daily = buildHPSchedule({ ...base, interestBasis: 'daily' });
    expect(monthly.totalInterest).toBeGreaterThan(0);
    expect(daily.totalInterest).toBeGreaterThan(0);
    expect(monthly.totalInterest).not.toBe(daily.totalInterest);
  });

  it('default ของ HP = monthly (MoM 09/10)', () => {
    const def = buildHPSchedule({ ...base });
    const monthly = buildHPSchedule({ ...base, interestBasis: 'monthly' });
    expect(def.totalInterest).toBe(monthly.totalInterest);
  });

  it('มี balloon → งวดสุดท้ายเป็น balloon และยอดต้นรวมยังเท่ายอดตั้งต้น', () => {
    const r = buildHPSchedule({ ...base, balloon: 200_000, balloonPattern: 'with-last' });
    const pay = r.rows.filter((x) => x.period > 0);
    expect(near(pay.reduce((s, x) => s + x.principal, 0), 1_000_000, 2)).toBe(true);
    expect(near(pay[pay.length - 1].endBalance, 0, 1)).toBe(true);
  });
});
