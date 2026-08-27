// ═══════════════════════════════════════════════════════════════════
//  จำนวนวันคิดดอกเบี้ย — ผลรวมทุกงวดต้องเท่ากับอายุสัญญาเสมอ
//
//  ที่มาของกฎ — เอกสารข้อกำหนด MGC_Loan-Lease_BRD V1.0
//    · จำนวนวันในงวด = วันสิ้นงวด − วันเริ่มงวด (ไม่นับวันเริ่ม)
//    · งวดถัดไปเริ่มวันเดียวกับที่งวดก่อนจบ
//      ตัวอย่างในเอกสาร  1 มิ.ย. → 30 มิ.ย. (29 วัน) · 30 มิ.ย. → 31 ก.ค. (31 วัน)
//      · 31 ก.ค. → 30 ส.ค. (30 วัน) · รวม 90 วัน = อายุสัญญา
//
//  เคยพลาดมาแล้ว — เดิมงวดถัดไปเริ่ม "วันถัดจาก" วันสิ้นงวด ทำให้วันรอยต่อ
//  เดือนไม่ถูกนับเป็นวันดอกเบี้ยของงวดไหนเลย · ขาดเดือนละ 1 วัน
//  สัญญา 120 วันคิดได้แค่ 117 วัน · สัญญา 1 ปีขาด 11 วัน
//
//  ชุดทดสอบนี้ล็อกกฎไว้ ถ้าใครแก้ตัวคำนวณแล้ววันหาย จะรู้ทันที
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildPNSchedule, totalDays } from '@/lib/pn-schedule';
import { buildFPSchedule } from '@/lib/fp-schedule';
import { computePeriodInterestSplit } from '@/lib/rate-helpers';
import type { RateCard } from '@/components/tx/RateCards';

const card = (rate: number, start: string | null = null): RateCard[] => [
  { id: 'rc-1', type: 'Fixed', rate, condition: 0, overlimit: 0, start_date: start },
];

/** อายุสัญญาเป็นวัน — ปลายลบต้น ตามที่เอกสารกำหนด */
const term = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

describe('ตั๋วสัญญาใช้เงิน · ทรัสต์รีซีท — ผลรวมวันเท่ากับอายุสัญญา', () => {
  const cases: [string, string, string][] = [
    ['ข้ามเดือน 4 งวด',        '2026-06-01', '2026-09-29'],
    ['เต็ม 1 ปี',              '2026-01-01', '2026-12-31'],
    ['คร่อมปี',                '2026-11-15', '2027-03-14'],
    ['เริ่มวันสิ้นเดือน',       '2026-01-31', '2026-05-31'],
    ['เริ่มวันที่ 31 เดือนยาว', '2026-03-31', '2026-07-31'],
    ['ผ่านเดือนกุมภาพันธ์',     '2026-01-15', '2026-04-15'],
    ['ปีอธิกสุรทิน',           '2028-01-15', '2028-04-15'],
    ['สั้นมาก ไม่ข้ามเดือน',    '2026-06-05', '2026-06-25'],
    ['จบพอดีวันสิ้นเดือน',      '2026-06-10', '2026-08-31'],
  ];

  for (const [name, start, end] of cases) {
    it(name, () => {
      const rows = buildPNSchedule(10_000_000, card(6), start, end).filter((r) => r.period > 0);
      const sum = rows.reduce((s, r) => s + r.days, 0);
      expect(sum).toBe(term(start, end));
      expect(sum).toBe(totalDays(start, end));
      // ทุกงวดต้องมีวันมากกว่าศูนย์ · ไม่มีงวดว่าง
      expect(rows.every((r) => r.days > 0)).toBe(true);
      // งวดถัดไปต้องเริ่มวันเดียวกับที่งวดก่อนจบ
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].startDate).toBe(rows[i - 1].endDate);
      }
    });
  }

  it('ตรงกับตัวอย่างในเอกสารข้อกำหนด — 1 มิ.ย. ถึง 29 ก.ย.', () => {
    const rows = buildPNSchedule(18_000_000, card(6.5), '2026-06-01', '2026-09-29')
      .filter((r) => r.period > 0);
    expect(rows.map((r) => [r.endDate, r.days])).toEqual([
      ['2026-06-30', 29],
      ['2026-07-31', 31],
      ['2026-08-31', 31],
      ['2026-09-29', 29],
    ]);
    expect(rows.reduce((s, r) => s + r.days, 0)).toBe(120);
  });

  it('ดอกเบี้ยรวมเท่ากับคิดตรงๆ ทั้งอายุสัญญา', () => {
    const rows = buildPNSchedule(18_000_000, card(6.5), '2026-06-01', '2026-09-29')
      .filter((r) => r.period > 0);
    const sum = rows.reduce((s, r) => s + r.interestPaid, 0);
    const straight = (18_000_000 * 6.5 * 120) / 100 / 365;
    expect(Math.abs(sum - straight)).toBeLessThan(0.05);
  });
});

describe('สินเชื่อรถในสต๊อก — ผลรวมวันเท่ากับอายุสัญญา', () => {
  const cases: [string, string, string][] = [
    ['6 เดือน',        '2026-05-01', '2026-10-28'],
    ['ข้ามปี',         '2026-10-10', '2027-04-10'],
    ['เริ่มสิ้นเดือน', '2026-01-31', '2026-06-30'],
  ];
  for (const [name, start, end] of cases) {
    it(name, () => {
      const rows = buildFPSchedule(22_000_000, card(5.75), start, end, 'other')
        .filter((r) => r.period > 0);
      const sum = rows.reduce((s, r) => s + r.days, 0);
      expect(sum).toBe(term(start, end));
    });
  }
});

describe('ตัวแบ่งช่วงอัตราดอกเบี้ย — ไม่ทำวันหายตอนข้ามเดือน', () => {
  it('อัตราเดียว — ผลเท่ากับคิดตรงๆ', () => {
    const got = computePeriodInterestSplit(card(6.5), 0, '2026-06-30', '2026-07-31', 18_000_000);
    const want = (18_000_000 * 6.5 * 31) / 100 / 365;
    expect(Math.abs(got - want)).toBeLessThan(0.02);
  });

  it('ช่วงยาวข้ามหลายเดือน — ผลเท่ากับคิดตรงๆ', () => {
    const got = computePeriodInterestSplit(card(5), 0, '2026-01-01', '2026-12-31', 10_000_000);
    const want = (10_000_000 * 5 * 364) / 100 / 365;
    expect(Math.abs(got - want)).toBeLessThan(0.05);
  });

  it('เปลี่ยนอัตรากลางช่วง — แบ่งตามวันจริงของแต่ละอัตรา', () => {
    const cards: RateCard[] = [
      { id: 'a', type: 'Fixed', rate: 6, condition: 0, overlimit: 0, start_date: null },
      { id: 'b', type: 'Fixed', rate: 8, condition: 0, overlimit: 0, start_date: '2026-07-01' },
    ];
    const got = computePeriodInterestSplit(cards, 0, '2026-06-01', '2026-08-01', 12_000_000);
    // มิ.ย. 29 วันที่ 6% + ก.ค. 31 วันที่ 8% (นับ 1 มิ.ย.→30 มิ.ย. แล้ว 30 มิ.ย.→31 ก.ค.)
    expect(got).toBeGreaterThan(0);
    // ผลต้องอยู่ระหว่างคิด 6% ล้วนกับ 8% ล้วนตลอดช่วง
    const lo = (12_000_000 * 6 * 61) / 100 / 365;
    const hi = (12_000_000 * 8 * 61) / 100 / 365;
    expect(got).toBeGreaterThan(lo);
    expect(got).toBeLessThan(hi);
  });
});

describe('สูตรตรงกับรายงานตัวจริงของธนาคาร', () => {
  // จากรายงาน Rental Charges Unit by Unit ของดีลเลอร์ ZEEKR ออก 1 มี.ค. 2569
  const rental = (amount: number, rate: number, days: number) =>
    Math.round(((amount * rate * days) / 100 / 365) * 100) / 100;

  it.each([
    [1_535_040, 2.87, 11, 1_327.70],
    [1_727_040, 2.87, 26, 3_530.73],
    [1_535_040, 2.87, 28, 3_379.61],
    [1_343_040, 2.87, 11, 1_161.64],
    [1_535_040, 2.87, 4, 482.80],
  ])('ราคา %s อัตรา %s%% %s วัน = %s', (amount, rate, days, expected) => {
    expect(rental(amount, rate, days)).toBe(expected);
  });
});
