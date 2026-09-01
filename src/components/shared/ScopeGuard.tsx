import { useAuth } from '@/lib/auth';
import { canSeeSubsidiary, canSeeMasterAgreement } from '@/lib/subsidiary-scope';

/**
 * กันเปิดรายการของบริษัทที่ตัวเองไม่ได้ดูแล
 *
 * การกรองในหน้ารายการทำให้รายการหายไปจากตารางก็จริง แต่ผู้ใช้ยังพิมพ์ที่อยู่หน้า
 * รายละเอียดเข้าไปตรงๆ ได้ ถ้าเดารหัสรายการถูกหรือได้ลิงก์มาจากคนอื่น
 * ตัวนี้จึงต้องมีคู่กับการกรองเสมอ
 *
 * ยังไม่โหลดข้อมูลเสร็จ (subsidiary เป็น undefined) ให้ผ่านไปก่อน
 * ไม่งั้นจะเห็นข้อความไม่มีสิทธิ์แว้บขึ้นมาทุกครั้งที่เปิดหน้า
 */
export function ScopeGuard({
  subsidiary,
  allocated,
  skip,
  children,
}: {
  /** บริษัทเจ้าของรายการ · undefined = ยังโหลดไม่เสร็จ */
  subsidiary: string | null | undefined;
  /** เฉพาะสัญญาหลัก — บริษัทในตารางจัดสรร */
  allocated?: (string | null | undefined)[];
  /** ข้ามการตรวจ — ใช้กับหน้าสร้างใหม่ที่ยังไม่มีบริษัท */
  skip?: boolean;
  children: React.ReactNode;
}) {
  const { scope } = useAuth();

  // หน้าสร้างใหม่ยังไม่มีบริษัทเป็นธรรมดา ต้องปล่อยให้กรอกก่อน
  // แล้วค่อยตรวจตอนบันทึก ไม่ใช่กันตั้งแต่ยังไม่ได้เริ่มกรอก
  if (skip) return <>{children}</>;

  if (subsidiary === undefined) return <>{children}</>;

  const ok = allocated
    ? canSeeMasterAgreement(scope, subsidiary, allocated)
    : canSeeSubsidiary(scope, subsidiary);

  if (ok) return <>{children}</>;

  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
      <p className="text-sm font-semibold text-amber-900">รายการนี้ไม่ได้อยู่ในบริษัทที่คุณดูแล</p>
      <p className="mt-1 text-xs text-amber-800">
        ถ้าต้องใช้งาน ให้ติดต่อผู้ดูแลระบบเพื่อขอเพิ่มบริษัทในโปรไฟล์ของคุณ
      </p>
    </div>
  );
}
