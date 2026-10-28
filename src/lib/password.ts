// Hash รหัสผ่านก่อนเก็บลง DB — ไม่เก็บ plain text
// หมายเหตุ: SHA-256 เป็นมาตรการขั้นต่ำสำหรับช่วง demo · ตอนต่อ auth จริง
// ควรย้ายไปใช้ Supabase Auth / bcrypt (มี salt + slow hash) แทน
export async function hashPassword(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  return (await hashPassword(plain)) === hash;
}
