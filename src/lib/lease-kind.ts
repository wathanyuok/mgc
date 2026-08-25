// สัญญาเช่า 3 ชนิด — ที่เดียวที่แปลง mode เป็นเส้นทางหน้าจอ รหัสสิทธิ์ และชื่อที่ผู้ใช้เห็น
//
//   hp    Hire Purchase   ใช้วงเงินธนาคาร · กรรมสิทธิ์โอนให้ผู้เช่าซื้อเมื่อผ่อนครบ
//   lease Leasing         ใช้วงเงินธนาคาร · กรรมสิทธิ์ยังเป็นของผู้ให้เช่า
//   other Leasing Other   ไม่ใช้วงเงินธนาคาร · เช่าที่ดิน อาคาร โกดัง
//
// อย่าเขียนเงื่อนไขแบบ "ถ้าไม่ใช่ hp ก็ other" กระจายตามไฟล์อีก — ชนิดที่ 3 จะถูกพาไปหน้าผิด

export type LeaseMode = 'hp' | 'lease' | 'other';

export const LEASE_ROUTE: Record<LeaseMode, string> = {
  hp: '/lease/hp',
  lease: '/lease/leasing',
  other: '/lease/other',
};

export const LEASE_MENU_KEY: Record<LeaseMode, string> = {
  hp: 'lease_hp',
  lease: 'lease_leasing',
  other: 'lease_other',
};

export const LEASE_LABEL: Record<LeaseMode, string> = {
  hp: 'Hire Purchase',
  lease: 'Leasing',
  other: 'Leasing Other',
};

/** ใช้วงเงินธนาคารหรือไม่ — Leasing Other ไม่ใช้ จึงไม่ต้องมี Master/Credit Agreement */
export const usesBankCredit = (mode: LeaseMode) => mode !== 'other';

/** เส้นทางหน้ารายละเอียด · รับค่าที่อาจว่างได้ แล้วถอยไปหน้า Hire Purchase */
export function leaseRoute(mode: string | null | undefined, id?: string) {
  const base = LEASE_ROUTE[(mode as LeaseMode)] ?? LEASE_ROUTE.hp;
  return id ? `${base}/${id}` : base;
}
