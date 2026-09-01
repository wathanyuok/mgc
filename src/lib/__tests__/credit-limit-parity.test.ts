// กติกาการนับยอดใช้วงเงินเขียนไว้ 2 ที่ — หน้าจอกับฐานข้อมูล
//
// หน้าจอ  : src/lib/credit-limit.ts   คำนวณสดตอนกดบันทึก เพื่อเช็คว่าเกินวงเงินไหม
//           (ต้องคำนวณสด เพราะต้องกันไม่ให้นับรายการที่กำลังแก้อยู่ซ้ำกับตัวเอง)
// ฐานข้อมูล: 0101 + 0102              เขียนยอดลงตาราง เพื่อให้ไหลขึ้นถึง MA
//
// สองที่นี้ต้องนับเหมือนกันเป๊ะ ไม่งั้นหน้าบันทึกกับรายงานจะบอกตัวเลขคนละอย่าง
// บนวงเงินใบเดียวกัน — เคยเกิดมาแล้วตอนที่ตรรกะแยกกันคนละไฟล์
//
// ชุดตรวจนี้อ่านไฟล์ทั้งสองแล้วเทียบกติกาให้ ถ้าใครแก้ข้างเดียวจะสอบตก
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLOSED_STATUS_LIST,
  NEVER_DREW_STATUS_LIST,
  DRAWDOWN_TABLES,
  EXTRA_CLOSED_BY_TABLE,
  REPAY_CODES_BY_TABLE,
  isSubContract,
} from '../credit-limit';

const mig = (f: string) => readFileSync(resolve(__dirname, '../../../supabase/migrations/', f), 'utf-8');

const rollup = mig('0101_ca_utilization_rollup.sql');          // ต่อสายให้ยอดไหลขึ้น
const netting = mig('0102_ca_utilization_net_of_principal.sql'); // หักเงินต้นที่จ่ายคืนแล้ว

/** ตัวคำนวณยอดใช้วงเงินฉบับล่าสุด — 0102 เขียนทับของ 0101 */
const recalcBody = netting.split('function recalc_ca_utilization')[1] ?? '';

/** ดึงรายชื่อสถานะออกจากฟังก์ชันในไฟล์ฐานข้อมูล */
function statusesFrom(fn: string): string[] {
  const body = rollup.split(`create or replace function ${fn}()`)[1] ?? '';
  return [...(body.split('$$')[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** ดึงคู่ ตาราง → คอลัมน์ยอดเงิน ออกจากคำสั่งรวมยอดฉบับล่าสุด */
function tablesFrom(): { table: string; amountCol: string }[] {
  const body = recalcBody.split('select coalesce(sum(amt), 0)')[1]?.split(') t;')[0] ?? '';
  return body
    .split('union all')
    .map((chunk) => {
      const table = chunk.match(/from\s+([a-z_0-9]+)/)?.[1];
      // คอลัมน์ยอดเงินคือตัวแรกหลัง select — ทั้งแบบหักและไม่หัก
      const col = chunk.match(/greatest\(\s*([a-z_0-9]+)/)?.[1] ?? chunk.match(/select\s+([a-z_0-9]+)/)?.[1];
      return table && col ? { table, amountCol: col } : null;
    })
    .filter((x): x is { table: string; amountCol: string } => !!x);
}

const byTable = (a: { table: string }, b: { table: string }) => a.table.localeCompare(b.table);

describe('กติกานับยอดใช้วงเงิน — หน้าจอกับฐานข้อมูลต้องตรงกัน', () => {
  it('สถานะที่แปลว่าสัญญาจบแล้ว วงเงินคืนมา', () => {
    expect(statusesFrom('ca_closed_statuses').sort()).toEqual([...CLOSED_STATUS_LIST].sort());
  });

  it('สถานะที่แปลว่าไม่เคยเบิกเลย (ใช้กับวงเงินไม่หมุนเวียน)', () => {
    expect(statusesFrom('ca_never_drew_statuses').sort()).toEqual([...NEVER_DREW_STATUS_LIST].sort());
  });

  it('ตารางที่กินวงเงิน และคอลัมน์ยอดเงินของแต่ละตาราง', () => {
    expect(tablesFrom().sort(byTable)).toEqual([...DRAWDOWN_TABLES].sort(byTable));
  });

  it('เงินกู้ยืมสถานะแก้ไขแล้ว ต้องไม่นับ — แต่สัญญาเช่าต้องนับ', () => {
    // สัญญาเงินกู้ที่ถูกแก้เงื่อนไข จะเปิดสัญญาใหม่แทน ฉบับเดิมจบแล้ว
    expect(EXTRA_CLOSED_BY_TABLE.loans).toContain('Modified');
    // สัญญาเช่าที่ถูกแก้ เป็นการปรับมูลค่าในฉบับเดิม ยังมีผลบังคับใช้อยู่
    expect(EXTRA_CLOSED_BY_TABLE.leases).toBeUndefined();

    expect(recalcBody.split('from loans')[1]?.split('union all')[0]).toContain("'Modified'");
    expect(recalcBody.split('from leases')[1]?.split('union all')[0]).not.toContain("'Modified'");
  });

  it('หนังสือเครดิตนับเฉพาะสัญญาแม่ ไม่นับสัญญาย่อยที่แบ่งรับมอบเป็นล็อต', () => {
    expect(isSubContract('letters_of_credit', { parent_lc_id: 'x' })).toBe(true);
    expect(isSubContract('letters_of_credit', { parent_lc_id: null })).toBe(false);
    expect(isSubContract('promissory_notes', { parent_lc_id: 'x' })).toBe(false);

    expect(recalcBody.split('from letters_of_credit')[1]?.split('union all')[0])
      .toContain('parent_lc_id is null');
  });

  it('สัญญาซื้อขายเงินตราล่วงหน้ากินวงเงินด้วยยอดบาท ไม่ใช่ยอดสกุลต่างประเทศ', () => {
    expect(DRAWDOWN_TABLES.find((t) => t.table === 'fx_forwards')?.amountCol).toBe('amount_thb');
    expect(recalcBody).toContain('select amount_thb from fx_forwards');
  });
});

describe('หักเงินต้นที่จ่ายคืนแล้ว — โมดูลไหนหัก โมดูลไหนไม่หัก', () => {
  it('โมดูลที่หัก ต้องตรงกันทั้งสองฝั่ง', () => {
    const inSql = [...recalcBody.matchAll(/facility_principal_repaid\(array\[([^\]]+)\], id\)/g)]
      .map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    // ทุกตารางที่หักในฝั่งฐานข้อมูล ต้องมีรหัสตรงกับที่หน้าจอใช้
    const sqlCodes = inSql.map((c) => c.join('|')).sort();
    const tsCodes = Object.values(REPAY_CODES_BY_TABLE).map((c) => [...c].join('|')).sort();
    expect(sqlCodes).toEqual(tsCodes);
  });

  it('เบิกเกินบัญชี · หนังสือค้ำประกัน · เงินตราล่วงหน้า ต้องไม่หัก', () => {
    // 3 ตัวนี้ยอดตามสัญญาไม่ใช่ยอดหนี้ที่ทยอยคืน หักออกแล้ววงเงินจะเพี้ยน
    for (const t of ['overdrafts', 'letter_guarantees', 'fx_forwards']) {
      expect(REPAY_CODES_BY_TABLE[t]).toBeUndefined();
      expect(recalcBody.split(`from ${t}`)[1]?.split('union all')[0])
        .not.toContain('facility_principal_repaid');
    }
  });

  it('สัญญาเช่ากับเช่าซื้อใช้ตารางเดียวกัน ต้องนับใบตัดชำระทั้งสองรหัส', () => {
    expect([...REPAY_CODES_BY_TABLE.leases]).toEqual(['Lease', 'HP']);
    expect(recalcBody).toContain("facility_principal_repaid(array['Lease','HP'], id)");
  });

  it('เงินกู้ยืมกับสินเชื่อสต๊อกรถ มีทางจ่ายคืนเงินต้นทางที่สองด้วย', () => {
    // เงินกู้ยืม: เมนูชำระก่อนกำหนดของตัวเอง · สต๊อกรถ: ทยอยคืนตามขั้นผ่านใบสำคัญ
    expect(recalcBody).toContain('loan_principal_prepaid(id)');
    expect(recalcBody).toContain('fp_principal_curtailed(id)');
  });

  it('นับเฉพาะใบตัดชำระที่ลงบัญชีแล้ว ใบร่างกับใบที่กลับรายการไม่นับ', () => {
    expect(netting).toContain("r.status = 'Posted'");
    expect(netting).toContain('is_reversal = false');
  });

  it('จ่ายเกินยอดสัญญาแล้วต้องไม่ติดลบ', () => {
    // ถ้าติดลบ จะไปเพิ่มวงเงินให้สัญญาฉบับอื่นโดยไม่มีใครรู้ตัว
    const guards = recalcBody.match(/greatest\(/g)?.length ?? 0;
    expect(guards).toBe(Object.keys(REPAY_CODES_BY_TABLE).length);
  });
});

describe('ตัวคำนวณในฐานข้อมูล — จุดที่พลาดแล้วเงียบ', () => {
  it('เทียบสถานะต้องแปลงเป็นข้อความก่อน เพราะแต่ละตารางใช้ชนิดกำหนดค่าเองคนละชนิด', () => {
    // ถ้าลืมแปลง ฐานข้อมูลจะฟ้องชนิดไม่ตรงตอนรัน ไม่ใช่ตอนติดตั้ง
    expect(recalcBody).not.toMatch(/\(status = any/);
    expect(recalcBody.match(/status::text = any/g)?.length).toBe(DRAWDOWN_TABLES.length);
  });

  it('ย้ายธุรกรรมข้ามวงเงินแล้ว ต้องคำนวณวงเงินใบเก่าใหม่ด้วย', () => {
    // ถ้าคำนวณแต่ใบใหม่ ใบเก่าจะค้างยอดของธุรกรรมที่ย้ายออกไปแล้ว
    expect(rollup).toContain('perform recalc_ca_utilization(old.ca_id)');
    expect(rollup).toContain('perform recalc_ca_utilization(new.ca_id)');
  });

  it('ติดตัวสะกิดครบทุกตารางที่กินวงเงิน', () => {
    const list = rollup.split('foreach t in array array[')[1]?.split(']')[0] ?? '';
    const names = [...list.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...DRAWDOWN_TABLES].map((t) => t.table).sort());
  });

  it('บันทึกรับชำระแล้ววงเงินต้องคืนทันที ไม่ต้องรอใครไปแตะสัญญา', () => {
    // ดูเฉพาะคำสั่งสร้างตัวสะกิดจริง — คำสั่งลบทิ้งก่อนสร้างก็มีชื่อตารางเหมือนกัน
    const created = [...netting.matchAll(/create trigger\s+\S+\s+after[^;]*?on\s+([a-z_0-9]+)/gs)]
      .map((m) => m[1])
      .sort();
    expect(created).toEqual(['journal_entries', 'loan_prepayments', 'repayment_lines', 'repayments']);
  });

  it('เติมค่าย้อนหลังให้ข้อมูลเดิมด้วย ไม่ใช่แค่รายการใหม่', () => {
    expect(netting).toContain('for r in select id from credit_agreements loop');
    expect(netting).toContain('for r in select id from master_agreements loop');
  });

  it('ยอดใช้วงเงินของบริษัทย่อยเขียนทับค่าที่หน้าจอส่งมาเสมอ', () => {
    // หน้าจอลบแถวทิ้งแล้วสร้างใหม่ทุกครั้งที่บันทึก ค่าที่ส่งมาอาจเก่าไปแล้ว
    expect(rollup).toContain('before insert or update on ma_subsidiaries');
    expect(rollup).toContain('new.utilization :=');
  });
});
