// Component กลางสำหรับช่อง STATUS (dropdown) — ให้ทุกโมดูลทำงานเหมือนกัน
//
// ปัญหาเดิม: แต่ละโมดูลเขียน <Select>{filterStatusOptions(...).map()}</Select> เอง
//   • ส่ง form.status (ค่าสด) → เลือกสถานะแล้ว options หดทันที เปลี่ยนใจก่อน save ไม่ได้ (ติดกับ)
//   • terminal ที่ไม่ตรง reject → หลุด เลือก Active/Approved ได้ (ข้ามอนุมัติ)
//
// component นี้รวมกฎไว้ที่เดียว:
//   1. คำนวณ options จาก savedStatus (สถานะที่บันทึกจริง) ไม่ใช่ค่าที่เพิ่งเลือก → ก่อน save เปลี่ยนใจได้
//   2. ส่ง module ให้ filterStatusOptions อ่าน terminal set → สถานะจบ revert เหลือ Draft เท่านั้น
//   3. workflow (Draft→Pending→Approved/Rejected) = ปุ่มเท่านั้น (คู่กับ ApprovalActions)
import { Select } from '@/components/ui';
import { filterStatusOptions } from '@/components/shared/ApprovalActions';
import type { ModuleKey } from '@/lib/status-lock';

export function StatusSelect({
  module,
  options,
  savedStatus,
  value,
  isApprover,
  approvedStatus = 'Approved',
  rejectStatus,
  onChange,
  disabled,
  className,
}: {
  module: ModuleKey;                       // อ่าน terminal set จาก status-lock
  options: readonly string[];              // รายการสถานะทั้งหมดของโมดูล
  savedStatus: string | null | undefined;  // สถานะที่ save จริงใน DB — ฐานคำนวณตัวเลือก
  value: string;                           // ค่าที่เลือกค้างในฟอร์ม (แสดงผล)
  isApprover: boolean;
  approvedStatus?: string;                 // 'Active' | 'Approved'
  rejectStatus?: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  // ตัวเลือกยึด "สถานะที่ save จริง" — ไม่ใช่ค่าที่เพิ่งเลือก → รายการไม่หดตอนเลือกค้างก่อน save
  const opts = filterStatusOptions(options, savedStatus ?? value, isApprover, approvedStatus, rejectStatus, module);
  // ค่าที่เลือกค้างต้องอยู่ในรายการเสมอ ไม่งั้นช่องจะหาค่าไม่เจอแล้ววนตั้งค่าซ้ำ
  const list = opts.includes(value) ? opts : [value, ...opts];
  return (
    <Select value={value} disabled={disabled} className={className} onChange={(e) => onChange(e.target.value)}>
      {list.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </Select>
  );
}
