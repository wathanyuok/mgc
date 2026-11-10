// =====================================================================
// FacilityRefFields — ชุด field "เลขอ้างอิงสัญญา" กลาง ใช้ร่วมทุกโมดูล
//   เพื่อให้ทุกโมดูล (PN/Loan/TR/FP/OD/LG/LC/FXF/Lease) มี pattern เดียวกัน:
//
//   1) NAME (auto)        — เลข/ชื่อที่ระบบ generate อัตโนมัติ · read-only · ว่าง→ระบบสร้างตอน Save
//   2) [XXX] NUMBER       — เลขสัญญาจากธนาคาร (ชื่อ label ตามโมดูล) · optional · กรอกทีหลังได้
//   3) BANK REFERENCE     — เลขอ้างอิงจับคู่ Bank Statement · optional · กรอกทีหลังได้
//
//   รับ value/onChange แบบ controlled ทั่วไป → ใช้ได้ทั้งฟอร์ม tx (useState) และ Lease (react-hook-form)
// =====================================================================
import { FieldLabel, Input } from '@/components/ui';

/**
 * BankReferenceField — ช่อง BANK REFERENCE กลาง (ใช้เดี่ยว ๆ ได้ทุกโมดูล)
 *   เลขอ้างอิงจากธนาคาร · ใช้จับคู่ Bank Statement · ไม่บังคับ · กรอกภายหลังได้
 */
export function BankReferenceField({
  value,
  onChange,
  disabled = false,
  label = 'BANK REFERENCE',
}: {
  value?: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div>
      <FieldLabel tipKey="BANK REFERENCE">{label}</FieldLabel>
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="MCL 11 หลัก (SCB) · หรือเลขที่ธนาคารให้"
        disabled={disabled}
      />
      <p className="text-[10px] text-muted mt-0.5 italic">ไม่บังคับ — ใช้จับคู่รายการใน Bank Statement · กรอกภายหลังได้</p>
    </div>
  );
}

export interface FacilityRefFieldsProps {
  /** NAME (auto) — ค่าที่ระบบสร้าง (เช่น HP00001) · read-only · ว่าง = ยังไม่ save */
  nameValue?: string | null;
  namePlaceholder?: string;

  /** เลขสัญญาจากธนาคาร — label ตามโมดูล (เช่น "T/R NUMBER", "CONTRACT NUMBER") */
  numberLabel: string;
  numberValue?: string | null;
  onNumberChange: (v: string) => void;
  numberPlaceholder?: string;
  numberTipKey?: string;

  /** BANK REFERENCE — ซ่อนได้ (บางโมดูลใช้เลขธนาคารตัวเดียว) · default แสดง */
  showBankRef?: boolean;
  bankRefValue?: string | null;
  onBankRefChange?: (v: string) => void;

  disabled?: boolean;
}

export function FacilityRefFields({
  nameValue,
  namePlaceholder = 'auto — running no. (สร้างเมื่อ Save)',
  numberLabel,
  numberValue,
  onNumberChange,
  numberPlaceholder,
  numberTipKey,
  showBankRef = true,
  bankRefValue,
  onBankRefChange,
  disabled = false,
}: FacilityRefFieldsProps) {
  return (
    <>
      {/* 1) NAME (auto) — ระบบ generate ให้ · read-only */}
      <div>
        <FieldLabel tipKey="NAME (auto)">NAME (auto)</FieldLabel>
        <Input readOnly value={nameValue ?? ''} placeholder={namePlaceholder} className="bg-gray-50 text-muted" />
      </div>

      {/* 2) เลขสัญญาจากธนาคาร — กรอกทีหลังได้ */}
      <div>
        <FieldLabel tipKey={numberTipKey}>{numberLabel}</FieldLabel>
        <Input
          value={numberValue ?? ''}
          onChange={(e) => onNumberChange(e.target.value)}
          placeholder={numberPlaceholder}
          disabled={disabled}
        />
        <p className="text-[10px] text-muted mt-0.5 italic">ไม่บังคับ — กรอกภายหลังได้เมื่อได้เลขจากธนาคาร</p>
      </div>

      {/* 3) BANK REFERENCE — ใช้จับคู่ Bank Statement · กรอกทีหลังได้ */}
      {showBankRef && (
        <BankReferenceField value={bankRefValue} onChange={(v) => onBankRefChange?.(v)} disabled={disabled} />
      )}
    </>
  );
}
