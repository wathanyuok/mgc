// =====================================================================
// ทวนกฎที่กระทบตัวเลขเงิน — กันไม่ให้ข้อผิดพลาดเดิมกลับมาอีก
//
// ทุกข้อในไฟล์นี้เคยเป็นข้อผิดพลาดจริงที่พบตอนตรวจก่อนเริ่มทดสอบระบบ
// รันด้วย:  npx vitest run src/lib/money-rules.test.ts
// =====================================================================
import { describe, it, expect } from 'vitest';
import { calcLCFee } from './lc-fee-schedule';
import {
  CLOSED_STATUS_LIST, NEVER_DREW_STATUS_LIST, DRAWDOWN_TABLES, isSubContract,
} from './credit-limit';
import { isChassisHolderOpen } from './chassis-overlap';
import { LG_ENDED_STATUSES, LC_ENDED_STATUSES } from './offbalance-reverse';

describe('ค่าธรรมเนียม L/C — ต้องใช้สูตรกลางที่เดียว', () => {
  it('คิดเต็มอายุสัญญา = ยอดเงิน × อัตรา', () => {
    expect(calcLCFee({ amount: 10_000_000, fee_rate: 1, fee_mode: 'full_term' }).fee)
      .toBe(100_000);
  });

  it('คิดตามจำนวนวันที่ใช้จริง = ค่าธรรมเนียมแรกเข้า + เฉลี่ยตามวัน', () => {
    // เคสนี้เคยผิด: ตารางผ่อนกลางคิดเป็น 100,000 (มากกว่าความจริง 3.4 เท่า)
    const fee = calcLCFee({
      amount: 10_000_000, fee_rate: 1, fee_mode: 'engagement_prorated',
      engagement_fee: 5_000, term_days: 90,
    }).fee;
    expect(Math.round(fee * 100) / 100).toBe(29_657.53);
  });

  it('ไม่มีข้อมูลก็ต้องไม่พัง', () => {
    expect(calcLCFee({}).fee).toBe(0);
  });
});

describe('วงเงิน — หน้าบันทึกกับรายงานต้องนับเหมือนกัน', () => {
  it('นับ L/C และสัญญาเช่าด้วย', () => {
    const tables = DRAWDOWN_TABLES.map((t) => t.table);
    expect(tables).toContain('letters_of_credit');
    expect(tables).toContain('leases');
  });

  it.each(['Expired', 'Terminated', 'Converted', 'Settled'])(
    'สถานะ "%s" ต้องคืนวงเงิน', (s) => {
      expect(CLOSED_STATUS_LIST as readonly string[]).toContain(s);
    });

  it('สัญญาที่แก้ไขแล้ว (Modified) ยังมีผลบังคับใช้ ต้องยังกินวงเงิน', () => {
    expect(CLOSED_STATUS_LIST as readonly string[]).not.toContain('Modified');
  });

  it('สัญญาที่ใช้งานอยู่ต้องกินวงเงิน', () => {
    expect(CLOSED_STATUS_LIST as readonly string[]).not.toContain('Active');
  });

  it('วงเงินไม่หมุนเวียน คืนเฉพาะสัญญาที่ไม่เคยเบิก', () => {
    expect([...NEVER_DREW_STATUS_LIST]).toEqual(['Cancelled', 'Rejected', 'Voided']);
  });
});

describe('L/C แบ่งรับมอบเป็น lot — ห้ามนับวงเงินซ้ำ', () => {
  it('สัญญาย่อยไม่ถูกนับ (นับที่สัญญาแม่แล้ว)', () => {
    expect(isSubContract('letters_of_credit', { parent_lc_id: 'abc' })).toBe(true);
  });

  it('สัญญาแม่ถูกนับ', () => {
    expect(isSubContract('letters_of_credit', { parent_lc_id: null })).toBe(false);
  });

  it('ตารางอื่นไม่โดนกรองผิด', () => {
    expect(isSubContract('promissory_notes', { parent_lc_id: 'abc' })).toBe(false);
  });
});

describe('ตรวจเลขตัวถังซ้ำ — ต้องเห็นสัญญาที่ยังถือรถอยู่ทุกฉบับ', () => {
  it.each(['Active', 'Draft', 'Pending Approval', 'Roll Over', 'Modified', 'Approved'])(
    'สถานะ "%s" ต้องถูกตรวจเจอ', (s) => {
      expect(isChassisHolderOpen(s)).toBe(true);
    });

  it.each(['Closed', 'Repaid', 'Cancelled', 'Terminated', 'Rejected', 'Expired', 'Converted'])(
    'สถานะ "%s" ปิดแล้ว ไม่ต้องตรวจ', (s) => {
      expect(isChassisHolderOpen(s)).toBe(false);
    });

  it('สถานะใหม่ที่ยังไม่รู้จัก ต้องรายงานไว้ก่อน ไม่ใช่เงียบ', () => {
    // นี่คือหัวใจของการแก้: วิธีเดิมระบุ "สถานะที่เปิดอยู่" พอมีค่าใหม่แล้วลืมเติม
    // ระบบจะตรวจไม่เจอโดยไม่มีสัญญาณเตือนใดๆ
    expect(isChassisHolderOpen('สถานะที่เพิ่งเพิ่มเข้ามา')).toBe(true);
  });
});

describe('ภาระผูกพันนอกงบ — ต้องกลับรายการทุกทางที่สัญญาจบ', () => {
  it.each(['Expired', 'Terminated', 'Closed', 'Cancelled', 'Roll Over'])(
    'หนังสือค้ำประกันสถานะ "%s"', (s) => {
      expect(LG_ENDED_STATUSES).toContain(s);
    });

  it('ต่ออายุต้องกลับรายการ ไม่งั้นยอดจะทบทุกครั้งที่ต่อ', () => {
    expect(LG_ENDED_STATUSES).toContain('Roll Over');
  });

  it('สัญญาที่ยังใช้งานอยู่ต้องไม่ถูกกลับรายการ', () => {
    expect(LG_ENDED_STATUSES).not.toContain('Active');
  });

  it.each(['Expired', 'Cancelled', 'Closed', 'Converted'])(
    'L/C สถานะ "%s"', (s) => {
      expect(LC_ENDED_STATUSES).toContain(s);
    });
});
