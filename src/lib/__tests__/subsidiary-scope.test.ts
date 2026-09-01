import { describe, it, expect } from 'vitest';
import {
  canSeeSubsidiary,
  canSeeMasterAgreement,
  scopeFilter,
  assertCanUseSubsidiary,
  filterCaOptions,
  EMPTY_SCOPE,
  type SubsidiaryScope,
} from '../subsidiary-scope';

const only = (...codes: string[]): SubsidiaryScope => ({ all: false, codes });
const everything: SubsidiaryScope = { all: true, codes: [] };

describe('ผู้ใช้เห็นรายการของบริษัทไหนได้บ้าง', () => {
  it('ดูแลบริษัทเดียว เห็นเฉพาะของบริษัทนั้น', () => {
    expect(canSeeSubsidiary(only('MCR'), 'MCR')).toBe(true);
    expect(canSeeSubsidiary(only('MCR'), 'MAG')).toBe(false);
  });

  it('ดูแลหลายบริษัท เห็นได้ทุกบริษัทที่ดูแล', () => {
    const s = only('MAG', 'AZM', 'i24');
    expect(canSeeSubsidiary(s, 'MAG')).toBe(true);
    expect(canSeeSubsidiary(s, 'AZM')).toBe(true);
    expect(canSeeSubsidiary(s, 'MCR')).toBe(false);
  });

  it('ดูแลทุกบริษัท เห็นหมด', () => {
    expect(canSeeSubsidiary(everything, 'MCR')).toBe(true);
    expect(canSeeSubsidiary(everything, 'ZMP')).toBe(true);
  });

  it('ยังไม่ได้เข้าระบบ ไม่เห็นอะไรเลย', () => {
    // ผู้ใช้ที่เข้าระบบแล้วต้องมีบริษัทเสมอ ฐานข้อมูลบังคับไว้
    // ขอบเขตว่างเปล่าจึงเกิดเฉพาะตอนยังไม่เข้าระบบหรือกำลังโหลด
    expect(canSeeSubsidiary(EMPTY_SCOPE, 'MCR')).toBe(false);
  });

  it('รายการที่ยังไม่ระบุบริษัท เห็นได้เฉพาะคนที่ดูแลทุกบริษัท', () => {
    // ข้อมูลเก่าที่ยังไม่ได้เติมบริษัท ต้องไม่หลุดไปให้คนที่ไม่เกี่ยวข้องเห็น
    expect(canSeeSubsidiary(only('MCR'), null)).toBe(false);
    expect(canSeeSubsidiary(only('MCR'), '')).toBe(false);
    expect(canSeeSubsidiary(everything, null)).toBe(true);
  });
});

describe('สัญญาหลัก — มีบริษัทสองที่ ต้องดูทั้งคู่', () => {
  it('เห็นได้ถ้าเป็นบริษัทคู่สัญญา', () => {
    expect(canSeeMasterAgreement(only('MCR'), 'MCR', ['AZM', 'MAG'])).toBe(true);
  });

  it('เห็นได้ถ้าได้รับจัดสรรวงเงิน แม้ไม่ใช่คู่สัญญา', () => {
    // ถ้าดูแค่คู่สัญญา บริษัทที่ได้วงเงินมาจะมองไม่เห็นสัญญาที่ตัวเองต้องใช้
    expect(canSeeMasterAgreement(only('AZM'), 'MCR', ['AZM', 'MAG'])).toBe(true);
  });

  it('ไม่เกี่ยวข้องเลย มองไม่เห็น', () => {
    expect(canSeeMasterAgreement(only('i24'), 'MCR', ['AZM', 'MAG'])).toBe(false);
  });

  it('สัญญาที่ยังไม่ได้จัดสรรให้ใคร ดูจากคู่สัญญาอย่างเดียว', () => {
    expect(canSeeMasterAgreement(only('MCR'), 'MCR', [])).toBe(true);
    expect(canSeeMasterAgreement(only('AZM'), 'MCR', [])).toBe(false);
  });

  it('ดูแลทุกบริษัท เห็นทุกสัญญา', () => {
    expect(canSeeMasterAgreement(everything, 'MCR', ['AZM'])).toBe(true);
    expect(canSeeMasterAgreement(everything, null, [])).toBe(true);
  });

  it('แถวจัดสรรที่ยังไม่ได้เลือกบริษัท ต้องไม่ทำให้เห็นทั้งสัญญา', () => {
    expect(canSeeMasterAgreement(only('MCR'), 'MAG', [null, undefined, ''])).toBe(false);
  });
});

describe('เงื่อนไขที่ส่งให้คิวรีเอาไปกรอง', () => {
  it('ดูแลทุกบริษัท ไม่ต้องกรอง', () => {
    expect(scopeFilter(everything)).toBeNull();
  });

  it('ดูแลบางบริษัท คืนรายชื่อไปกรอง', () => {
    expect(scopeFilter(only('MAG', 'AZM'))).toEqual(['MAG', 'AZM']);
  });

  it('ขอบเขตว่างเปล่า คืนรายการว่าง — กรองแล้วไม่เหลืออะไร', () => {
    // ต้องไม่คืน null เพราะจะกลายเป็นไม่กรองแล้วเห็นหมด
    expect(scopeFilter(EMPTY_SCOPE)).toEqual([]);
  });
});

describe('กันสร้างรายการให้บริษัทที่ตัวเองไม่ได้ดูแล', () => {
  it('ดูแลทุกบริษัท เลือกบริษัทไหนก็ผ่าน', () => {
    expect(assertCanUseSubsidiary(everything, 'MAG')).toBeNull();
  });

  it('เลือกบริษัทที่ตัวเองดูแล ผ่าน', () => {
    expect(assertCanUseSubsidiary(only('MCR', 'AZM'), 'AZM')).toBeNull();
  });

  it('เลือกบริษัทที่ไม่ได้ดูแล คืนข้อความบอกว่าเลือกได้บริษัทไหนบ้าง', () => {
    const msg = assertCanUseSubsidiary(only('MCR', 'AZM'), 'MAG');
    expect(msg).toContain('MAG');
    expect(msg).toContain('MCR');
    expect(msg).toContain('AZM');
  });

  it('ยังไม่ได้เลือกบริษัท ปล่อยให้ตัวตรวจช่องว่างจัดการ', () => {
    expect(assertCanUseSubsidiary(only('MCR'), '')).toBeNull();
    expect(assertCanUseSubsidiary(only('MCR'), null)).toBeNull();
    expect(assertCanUseSubsidiary(only('MCR'), undefined)).toBeNull();
  });

  it('ยังไม่ได้กำหนดบริษัทให้ผู้ใช้ ข้อความยังอ่านรู้เรื่อง', () => {
    expect(assertCanUseSubsidiary(EMPTY_SCOPE, 'MCR')).toContain('ยังไม่ได้กำหนด');
  });
});

describe('ตัวเลือกวงเงินในหน้าธุรกรรม', () => {
  const rows = [
    { id: '1', subsidiary: 'MCR' },
    { id: '2', subsidiary: 'MAG' },
    { id: '3', subsidiary: null },
  ];

  it('ดูแลทุกบริษัท เห็นครบ', () => {
    expect(filterCaOptions(everything, rows)).toHaveLength(3);
  });

  it('เห็นเฉพาะวงเงินของบริษัทที่ดูแล', () => {
    expect(filterCaOptions(only('MCR'), rows).map((r) => r.id)).toEqual(['1']);
  });

  it('วงเงินที่ยังไม่ระบุบริษัท คนที่ไม่ได้ดูแลทุกบริษัทไม่เห็น', () => {
    expect(filterCaOptions(only('MCR', 'MAG'), rows).map((r) => r.id)).toEqual(['1', '2']);
  });
});
