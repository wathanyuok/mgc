import { describe, it, expect } from 'vitest';
import {
  isLiveCaStatus,
  casBlockingRemoval,
  removalBlockedReason,
  type CaLike,
} from '../ma-allocation';

const ca = (subsidiary: string, status: string, contract_number?: string): CaLike => ({
  subsidiary,
  status,
  contract_number,
  ca_name: `CA ของ ${subsidiary}`,
});

describe('วงเงินย่อยแบบไหนยังกินโควตาอยู่', () => {
  it('ฉบับร่าง รออนุมัติ อนุมัติแล้ว — ยังกินโควตา', () => {
    expect(isLiveCaStatus('Draft')).toBe(true);
    expect(isLiveCaStatus('Pending Approval')).toBe(true);
    expect(isLiveCaStatus('Approved')).toBe(true);
  });

  it('ปิดไปแล้วทุกแบบ — ไม่กินโควตา', () => {
    for (const s of ['Rejected', 'Expired', 'Closed', 'Terminated']) {
      expect(isLiveCaStatus(s)).toBe(false);
    }
  });

  it('ไม่มีสถานะ — ไม่นับ', () => {
    expect(isLiveCaStatus(null)).toBe(false);
    expect(isLiveCaStatus(undefined)).toBe(false);
    expect(isLiveCaStatus('')).toBe(false);
  });
});

describe('เอาบริษัทออกจากตารางจัดสรรได้ไหม', () => {
  const cas = [
    ca('AZM', 'Approved', 'CA-001'),
    ca('AZM', 'Closed', 'CA-002'),
    ca('MAG', 'Terminated', 'CA-003'),
  ];

  it('บริษัทที่ยังมีวงเงินย่อยใช้อยู่ — เอาออกไม่ได้', () => {
    expect(casBlockingRemoval(cas, 'AZM')).toHaveLength(1);
    expect(removalBlockedReason(cas, 'AZM')).toContain('CA-001');
  });

  it('บริษัทที่วงเงินย่อยปิดหมดแล้ว — เอาออกได้', () => {
    expect(casBlockingRemoval(cas, 'MAG')).toHaveLength(0);
    expect(removalBlockedReason(cas, 'MAG')).toBeNull();
  });

  it('บริษัทที่ไม่เคยมีวงเงินย่อยเลย — เอาออกได้', () => {
    expect(removalBlockedReason(cas, 'MCR')).toBeNull();
  });

  it('แถวที่ยังไม่ได้เลือกบริษัท — ไม่มีอะไรให้ตรวจ', () => {
    expect(removalBlockedReason(cas, '')).toBeNull();
    expect(removalBlockedReason(cas, null)).toBeNull();
  });

  it('ข้อความบอกจำนวนใบและวิธีแก้', () => {
    const msg = removalBlockedReason(cas, 'AZM')!;
    expect(msg).toContain('1 ใบ');
    expect(msg).toContain('ปิดวงเงินย่อย');
  });

  it('ขวางเกิน 3 ใบ — ย่อรายการแล้วบอกว่าเหลืออีกกี่ใบ', () => {
    const many = ['CA-01', 'CA-02', 'CA-03', 'CA-04', 'CA-05'].map((n) => ca('AZM', 'Approved', n));
    const msg = removalBlockedReason(many, 'AZM')!;
    expect(msg).toContain('5 ใบ');
    expect(msg).toContain('และอีก 2 ใบ');
    expect(msg).not.toContain('CA-04');
  });

  it('ไม่มีเลขที่สัญญา — ใช้ชื่อแทน', () => {
    const noNumber: CaLike[] = [{ subsidiary: 'AZM', status: 'Approved', ca_name: 'วงเงินหมุนเวียน' }];
    expect(removalBlockedReason(noNumber, 'AZM')).toContain('วงเงินหมุนเวียน');
  });
});
