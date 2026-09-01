// กรองรายการตามบริษัทที่ผู้ใช้ดูแล — ตัวช่วยที่ทุกหน้ารายการเรียกใช้ร่วมกัน
//
// แยกจาก subsidiary-scope.ts เพราะไฟล์นั้นเป็นตรรกะล้วน ไม่แตะฐานข้อมูล จึงทดสอบง่าย
// ส่วนไฟล์นี้ต้องไปอ่านฐานข้อมูลเพื่อไล่หาบริษัทของรายการ
import { supabase } from './supabase';
import { canSeeSubsidiary, type SubsidiaryScope } from './subsidiary-scope';

/** แถวที่กรองได้ — มีบริษัทของตัวเอง หรือผูกกับวงเงินย่อย */
interface ScopableRow {
  subsidiary?: string | null;
  ca_id?: string | null;
}

/**
 * กรองรายการให้เหลือเฉพาะบริษัทที่ผู้ใช้ดูแล
 *
 * บริษัทของรายการหาได้ 2 ทาง เรียงตามลำดับ
 *   1. ช่องบริษัทของตัวเอง — สัญญาหลัก · วงเงินย่อย · สัญญาเช่า
 *   2. ไล่ขึ้นไปที่วงเงินย่อยที่ผูกอยู่ — ธุรกรรมทุกโมดูล
 *
 * รายการที่หาบริษัทไม่ได้เลย (ไม่มีทั้งสองทาง) เห็นได้เฉพาะคนที่ดูแลทุกบริษัท
 * เพราะปล่อยให้ทุกคนเห็นจะกลายเป็นช่องโหว่ตอนข้อมูลเก่ายังไม่ได้เติมบริษัท
 */
export async function filterByScope<T extends ScopableRow>(
  rows: T[],
  scope: SubsidiaryScope,
): Promise<T[]> {
  if (scope.all) return rows;
  if (rows.length === 0) return rows;

  // ดึงบริษัทของวงเงินย่อยมาทีเดียว เฉพาะแถวที่ยังไม่มีบริษัทของตัวเอง
  const needLookup = [
    ...new Set(rows.filter((r) => !r.subsidiary && r.ca_id).map((r) => r.ca_id as string)),
  ];
  const subOfCa = new Map<string, string | null>();
  if (needLookup.length > 0) {
    const { data } = await supabase
      .from('credit_agreements')
      .select('id, subsidiary')
      .in('id', needLookup);
    for (const c of (data ?? []) as any[]) subOfCa.set(c.id, c.subsidiary ?? null);
  }

  return rows.filter((r) => {
    const sub = r.subsidiary ?? (r.ca_id ? subOfCa.get(r.ca_id) ?? null : null);
    return canSeeSubsidiary(scope, sub);
  });
}

/**
 * บริษัทของรายการเดียว — ใช้กับหน้ารายละเอียดเพื่อกันพิมพ์ลิงก์เข้าตรง
 *
 * คืน undefined เมื่อยังไม่รู้ (ยังโหลดไม่เสร็จ) เพื่อให้ตัวกันปล่อยผ่านไปก่อน
 * ไม่งั้นจะเห็นข้อความไม่มีสิทธิ์แว้บขึ้นมาทุกครั้งที่เปิดหน้า
 */
export async function subsidiaryOfCa(caId: string | null | undefined): Promise<string | null> {
  if (!caId) return null;
  const { data } = await supabase
    .from('credit_agreements')
    .select('subsidiary')
    .eq('id', caId)
    .maybeSingle();
  return ((data as any)?.subsidiary ?? null) as string | null;
}
