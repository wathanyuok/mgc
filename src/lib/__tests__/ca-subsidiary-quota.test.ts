import { describe, it, expect } from 'vitest';
import {
  subsidiaryOptions,
  subsidiaryQuota,
  isOverQuota,
  type SubsidiaryAllocation,
} from '../ca-subsidiary-quota';

const ALL = ['MGC', 'MCR', 'MAG', 'AZM', 'i24'];
const alloc = (rows: [string, number, number][]): SubsidiaryAllocation[] =>
  rows.map(([subsidiary, credit_line, utilization]) => ({ subsidiary, credit_line, utilization }));

describe('บริษัทที่วงเงินย่อยเลือกได้', () => {
  it('ยังไม่เลือกสัญญาหลัก — เลือกได้ทุกบริษัท', () => {
    expect(subsidiaryOptions({
      maId: null, allocated: [], maMain: '', current: '', allCodes: ALL,
    })).toEqual(ALL);
  });

  it('สัญญาหลักจัดสรรแล้ว — เลือกได้เฉพาะบริษัทในตารางจัดสรร', () => {
    // MCR เซ็นสัญญา แต่คนที่ได้วงเงินไปใช้คือ AZM กับ MAG
    expect(subsidiaryOptions({
      maId: 'ma-1',
      allocated: alloc([['AZM', 300, 0], ['MAG', 200, 0]]),
      maMain: 'MCR',
      current: '',
      allCodes: ALL,
    })).toEqual(['AZM', 'MAG']);
  });

  it('บริษัทที่เซ็นสัญญาแต่ไม่ได้รับจัดสรร ต้องเลือกไม่ได้', () => {
    const opts = subsidiaryOptions({
      maId: 'ma-1',
      allocated: alloc([['AZM', 300, 0]]),
      maMain: 'MCR',
      current: '',
      allCodes: ALL,
    });
    expect(opts).not.toContain('MCR');
  });

  it('สัญญาหลักยังไม่จัดสรร — ใช้บริษัทบนหัวสัญญาเป็นตัวเลือกเดียว', () => {
    // บางสัญญาไม่ได้แตกบริษัท เซ็นเองใช้เอง
    expect(subsidiaryOptions({
      maId: 'ma-1', allocated: [], maMain: 'MCR', current: '', allCodes: ALL,
    })).toEqual(['MCR']);
  });

  it('สัญญาเก่าที่บริษัทเดิมไม่มีโควตาแล้ว ต้องยังเห็นค่าเดิมของตัวเอง', () => {
    // ไม่งั้นเปิดหน้าขึ้นมาช่องว่าง แล้วบันทึกทับข้อมูลเดิมโดยไม่ตั้งใจ
    expect(subsidiaryOptions({
      maId: 'ma-1',
      allocated: alloc([['AZM', 300, 0]]),
      maMain: 'MCR',
      current: 'i24',
      allCodes: ALL,
    })).toEqual(['AZM', 'i24']);
  });

  it('ค่าเดิมที่อยู่ในตารางจัดสรรอยู่แล้ว ต้องไม่ซ้ำสองรอบ', () => {
    expect(subsidiaryOptions({
      maId: 'ma-1',
      allocated: alloc([['AZM', 300, 0], ['MAG', 200, 0]]),
      maMain: 'MCR',
      current: 'AZM',
      allCodes: ALL,
    })).toEqual(['AZM', 'MAG']);
  });

  it('สัญญาหลักไม่มีทั้งตารางจัดสรรและบริษัทบนหัว — ไม่มีอะไรให้เลือก', () => {
    expect(subsidiaryOptions({
      maId: 'ma-1', allocated: [], maMain: '', current: '', allCodes: ALL,
    })).toEqual([]);
  });
});

describe('โควตาคงเหลือของบริษัทที่เลือก', () => {
  it('ยังไม่มีใครใช้ — เปิดได้เต็มโควตา', () => {
    expect(subsidiaryQuota(alloc([['AZM', 300, 0]]), 'AZM')).toEqual({
      allocated: 300, usedByOthers: 0, free: 300,
    });
  });

  it('มีวงเงินย่อยใบอื่นใช้ไปแล้ว — เหลือเท่าที่ยังว่าง', () => {
    expect(subsidiaryQuota(alloc([['AZM', 300, 120]]), 'AZM')).toEqual({
      allocated: 300, usedByOthers: 120, free: 180,
    });
  });

  it('แก้ใบเดิม ต้องหักวงเงินของตัวเองออกจากยอดที่ใช้ไป', () => {
    // ยอดในตารางจัดสรรรวมใบที่กำลังแก้อยู่ด้วย ถ้าไม่หักออกจะฟ้องเกินทั้งที่ไม่ได้เปลี่ยนอะไร
    expect(subsidiaryQuota(alloc([['AZM', 300, 200]]), 'AZM', 200)).toEqual({
      allocated: 300, usedByOthers: 0, free: 300,
    });
  });

  it('บริษัทที่ไม่มีแถวในตารางจัดสรร — ไม่มีโควตาให้เทียบ', () => {
    expect(subsidiaryQuota(alloc([['AZM', 300, 0]]), 'MCR')).toBeNull();
  });

  it('ยอดที่ใช้ไปติดลบไม่ได้ แม้ข้อมูลจะเพี้ยน', () => {
    const q = subsidiaryQuota(alloc([['AZM', 300, 50]]), 'AZM', 999);
    expect(q?.usedByOthers).toBe(0);
    expect(q?.free).toBe(300);
  });
});

describe('เตือนเมื่อเกินโควตา', () => {
  it('เท่ากับโควตาพอดี — ผ่าน', () => {
    expect(isOverQuota(subsidiaryQuota(alloc([['AZM', 300, 0]]), 'AZM'), 300)).toBe(false);
  });

  it('เกินโควตา — ฟ้อง', () => {
    expect(isOverQuota(subsidiaryQuota(alloc([['AZM', 300, 0]]), 'AZM'), 300.5)).toBe(true);
  });

  it('เกินเพราะใบอื่นใช้ไปแล้ว — ฟ้อง', () => {
    expect(isOverQuota(subsidiaryQuota(alloc([['AZM', 300, 250]]), 'AZM'), 100)).toBe(true);
  });

  it('เศษสตางค์จากการปัดเลข ต้องไม่ฟ้อง', () => {
    expect(isOverQuota(subsidiaryQuota(alloc([['AZM', 300, 0]]), 'AZM'), 300.005)).toBe(false);
  });

  it('ไม่มีโควตาให้เทียบ — ไม่ฟ้อง (ไปดักที่ตัวเลือกบริษัทแทน)', () => {
    expect(isOverQuota(null, 999_999)).toBe(false);
  });
});
