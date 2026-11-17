// ช่องตั้งค่าเงินก้อนท้าย (Balloon) — ใช้ร่วมทุกชนิดสัญญาเช่า (HP / Leasing / Lease Other)
//   แสดงเฉพาะเมื่อเลือก Payment Type ที่มีคำว่า Balloon — ผู้เรียกคุมการแสดง/ซ่อนเอง (showBalloonFields)
// แยกเป็น 2 ช่องเพราะวางคนละ slot: OPTION อยู่หลัง Payment Type · PAYMENT อยู่หลัง Payment Timing
import { Select, FieldLabel, NumInput } from '@/components/ui';

/** รูปแบบการวางเงินก้อนท้าย (พร้อมค่างวด / หลัง Term / ก่อน Term) */
export function BalloonOptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel>BALLOON OPTION</FieldLabel>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="with-last">พร้อมค่างวด (รวมในงวดสุดท้าย)</option>
        <option value="after-last">หลัง Term (เป็นงวด N+1)</option>
        <option value="before-last">ก่อน Term (ลดงวดเหลือ N-1)</option>
      </Select>
    </div>
  );
}

/** ยอดเงินก้อนท้าย · ignored = ใส่ยอดไว้แต่รูปแบบการชำระไม่รองรับ (เตือนบนจอ) */
export function BalloonPaymentField({
  value,
  onChange,
  ignored,
}: {
  value: number;
  onChange: (v: number) => void;
  ignored?: boolean;
}) {
  return (
    <div>
      <FieldLabel>BALLOON PAYMENT</FieldLabel>
      <NumInput value={value} onChange={onChange} step="0.01" />
      {ignored && (
        <p className="text-xs text-amber-700 mt-1">
          ⚠️ รูปแบบการชำระที่เลือกไม่รองรับเงินก้อนท้าย ระบบจึงไม่ได้คิดยอดนี้ในตารางผ่อน — เลือกรูปแบบการชำระแบบ (Balloon) ถ้าต้องการให้คิดจริง
        </p>
      )}
    </div>
  );
}
