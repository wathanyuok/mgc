// ═══════════════════════════════════════════════════════════════════
//  ดึงตัวเลขจากตัวคำนวณของระบบ ออกมาเป็นไฟล์ให้ตัวสร้างข้อมูลตัวอย่างใช้
//
//  ทำแบบนี้เพราะเคยพลาดมาแล้ว — ตอนแรกเขียนสูตรคำนวณซ้ำในตัวสร้างข้อมูล
//  ผลคือตัวเลขในใบสำคัญไม่ตรงกับตารางบนหน้าจอ ต้องไล่แก้ทีละรอบ
//
//  ตอนนี้ตัวเลขทุกตัวมาจากฟังก์ชันเดียวกับที่หน้าจอเรียกใช้ จะเพี้ยนไม่ได้
//
//  วิธีรัน   npx vitest run scripts/dump-seed-calcs.test.ts
//  ผลลัพธ์   /tmp/seed-calcs.json
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildPNSchedule } from '@/lib/pn-schedule';
import { buildLoanSchedule } from '@/lib/loan-schedule';
import type { RateCard } from '@/components/tx/RateCards';

const card = (rate: number): RateCard[] => [
  { id: 'seed', type: 'Fixed', rate, condition: 0, overlimit: 0, start_date: null },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** งวดดอกเบี้ยแบบตั๋วสัญญาใช้เงิน — ใช้กับ P/N · ทรัสต์รีซีท · สินเชื่อรถในสต๊อก · เบิกเกินบัญชี */
function interestPeriods(principal: number, rate: number, from: string, to: string) {
  return buildPNSchedule(principal, card(rate), from, to)
    .filter((p) => p.period > 0)
    .map((p) => ({
      period: p.period,
      start: p.startDate,
      end: p.endDate,
      days: p.days,
      interest: r2(p.interestPaid),
    }));
}

/** ตารางผ่อน — ใช้กับเงินกู้ · เช่าซื้อ · สัญญาเช่า */
function installments(principal: number, rate: number, months: number, start: string) {
  return buildLoanSchedule({
    principal,
    rateCards: card(rate),
    fallbackRate: rate,
    termMonths: months,
    installmentStart: start,
    paymentType: 'Fix Installment',
    payEom: false,
    paymentTiming: 'arrears',
  }).rows.map((r) => ({
    period: r.period,
    start: r.startDate,
    due: r.endDate,        // วันสิ้นงวด = วันครบกำหนดชำระค่างวด
    days: r.days,
    begin: r2(r.beginBalance),
    payment: r2(r.installment),
    interest: r2(r.interest),
    principal: r2(r.principal),
    end: r2(r.endBalance),
  }));
}

describe('ส่งออกตัวเลขให้ตัวสร้างข้อมูลตัวอย่าง', () => {
  it('เขียนไฟล์ /tmp/seed-calcs.json', () => {
    const out = {
      // ── ดอกเบี้ยรายงวด ─────────────────────────────────────────
      PN_004: interestPeriods(18_000_000, 6.50, '2026-06-01', '2026-09-29'),
      TR_004: interestPeriods(9_000_000, 6.75, '2026-06-01', '2026-09-29'),
      FP_004: interestPeriods(22_000_000, 5.75, '2026-05-01', '2026-10-28'),
      OD_004: interestPeriods(3_400_000, 7.25, '2026-06-01', '2026-07-31'),
      // ── ตารางผ่อน ─────────────────────────────────────────────
      LN_004: installments(20_000_000, 5.25, 60, '2026-03-01'),
      HP_004: installments(6_200_000, 4.50, 60, '2026-03-01'),
      LS_004: installments(5_400_000, 4.10, 60, '2026-04-01'),
      LO_004: installments(2_160_000, 0, 36, '2026-02-01'),
    };
    writeFileSync('/tmp/seed-calcs.json', JSON.stringify(out, null, 1), 'utf8');

    // กันไฟล์ว่างเปล่าโดยไม่รู้ตัว
    for (const [k, v] of Object.entries(out)) {
      expect(v.length, k).toBeGreaterThan(0);
    }
    // ผลรวมวันของดอกเบี้ยรายงวด ต้องเท่ากับอายุสัญญา
    expect(out.PN_004.reduce((s, p) => s + p.days, 0)).toBe(120);
    expect(out.TR_004.reduce((s, p) => s + p.days, 0)).toBe(120);
  });
});
