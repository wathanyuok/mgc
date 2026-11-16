import type { ReactNode } from 'react';
import { Select, FieldLabel, NumInput } from '@/components/ui';

export interface StepPhase { fromPeriod: number; installment: number }

/** Payment Type มาตรฐาน (ใช้ร่วม Loan/HP/Lease) — Grace แยกเป็น checkbox ไม่รวมในนี้ */
export const LOAN_PAYMENT_TYPES = [
  'Fix installment',
  'Step installment',
  'Fix installment with Balloon',
  'Step installment with Balloon',
  'Fix Principle',
  'Step Principle',
  'Fix Principle with Balloon',
  'Step Principle with Balloon',
] as const;

/** map payment_type แบบ label รวมของ Lease เดิม → คำแยกแบบ Loan (best-effort · default = Fix) */
export function toLoanPaymentType(pt: string | null | undefined): string {
  const s = (pt ?? '').toLowerCase();
  if (pt && (LOAN_PAYMENT_TYPES as readonly string[]).includes(pt)) return pt;
  if (!s) return 'Fix installment';
  const principal = s.includes('principal') || s.includes('principle');
  const balloon = s.includes('balloon');
  const base = principal ? 'Fix Principle' : 'Fix installment';
  return balloon ? `${base} with Balloon` : base;
}

export interface ScheduleFieldsValue {
  paymentType: string;
  paymentTiming: string;           // 'arrears' | 'advance'
  graceMonths: number;
  stepPhases: StepPhase[] | null;
}

interface Props {
  value: ScheduleFieldsValue;
  onChange: (patch: Partial<ScheduleFieldsValue>) => void;
  /** รายการ Payment Type (แต่ละ module ส่งคำของตัวเองมา) */
  paymentTypeOptions: readonly string[];
  /** แสดง Payment Timing ไหม (HP เช่าซื้อปลายงวดเสมอ อาจซ่อน) · default แสดง */
  showTiming?: boolean;
  disabled?: boolean;
  /** แทรก field ของโมดูล (เช่น Balloon Option) ไว้ "ระหว่าง" Payment Type กับ Payment Timing */
  slotAfterPaymentType?: ReactNode;
  /** แทรก field ของโมดูล ไว้ "ระหว่าง" Payment Timing กับ Grace */
  slotAfterPaymentTiming?: ReactNode;
  /** แทรก field ของโมดูล ไว้ "ก่อน" Step Payment (หลัง Grace) */
  slotBeforeStep?: ReactNode;
  /** ซ่อน Grace ภายใน (ให้โมดูล render เองที่ตำแหน่งอื่น) · default แสดง */
  showGrace?: boolean;
  /** ซ่อน Step ภายใน (ให้โมดูลเอา StepPaymentTable ไปวางเองที่ล่างสุด) · default แสดง */
  showStep?: boolean;
}

/**
 * Schedule Information fields กลาง (MoM 30Sep2026) — ใช้ร่วมได้ทุก module ที่มีตารางผ่อน
 *   Payment Type · Payment Timing · Grace Period · Step Payment (ค่างวดต่อช่วง)
 * เป็น controlled component (รับ value + onChange) จึงใช้ได้ทั้ง useState และ react-hook-form
 */
export function ScheduleFields({ value, onChange, paymentTypeOptions, showTiming = true, disabled = false, slotAfterPaymentType, slotAfterPaymentTiming, slotBeforeStep, showGrace = true, showStep = true }: Props) {
  const isStep = (value.paymentType ?? '').toLowerCase().includes('step');
  const phases = value.stepPhases ?? [];

  return (
    <>
      <div>
        <FieldLabel required className="text-red-600">PAYMENT TYPE</FieldLabel>
        <Select
          value={value.paymentType}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            const nextIsStep = next.toLowerCase().includes('step');
            onChange({ paymentType: next, stepPhases: nextIsStep ? value.stepPhases : null });
          }}
        >
          {paymentTypeOptions.map((t) => <option key={t}>{t}</option>)}
        </Select>
      </div>

      {slotAfterPaymentType}

      {showTiming && (
        <div>
          <FieldLabel className="text-red-600">PAYMENT TIMING</FieldLabel>
          <Select
            value={value.paymentTiming ?? 'arrears'}
            disabled={disabled}
            onChange={(e) => onChange({ paymentTiming: e.target.value })}
          >
            <option value="arrears">ชำระปลายงวด (Arrears)</option>
            <option value="advance">ชำระต้นงวด (Advance)</option>
          </Select>
          <p className="text-[10px] text-muted mt-0.5 italic">ต้นงวด = จ่ายค่างวดแรกวันเริ่มสัญญา (งวดแรกไม่มีดอกเบี้ย)</p>
        </div>
      )}

      {slotAfterPaymentTiming}

      {/* Grace Period — แยกเป็น checkbox ใช้ได้กับ payment type ทุกแบบ */}
      {showGrace && (
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none mt-6">
          <input
            type="checkbox"
            disabled={disabled}
            checked={(value.graceMonths ?? 0) > 0}
            onChange={(e) => onChange({ graceMonths: e.target.checked ? (value.graceMonths && value.graceMonths > 0 ? value.graceMonths : 1) : 0 })}
          />
          <span className="text-xs font-medium text-red-600">GRACE PERIOD (พักชำระต้นงวด) — เพิ่มใหม่</span>
        </label>
        {(value.graceMonths ?? 0) > 0 && (
          <div className="mt-2">
            <FieldLabel>GRACE PERIOD (MONTHS)</FieldLabel>
            <NumInput value={value.graceMonths ?? 0} onChange={(v) => onChange({ graceMonths: Math.max(0, Math.floor(v)) })} />
            <p className="text-[10px] text-muted mt-0.5 italic">จำนวนงวดต้นสัญญาที่จ่ายเฉพาะดอกเบี้ย (ยังไม่ตัดเงินต้น)</p>
          </div>
        )}
      </div>
      )}

      {slotBeforeStep}

      {/* Step Payment หลายช่วง — Loan ซ่อนในตัว (showStep=false) ไปวางเองที่ล่างสุด */}
      {showStep && isStep && (
        <StepPaymentTable stepPhases={phases} onPhasesChange={(p) => onChange({ stepPhases: p })} disabled={disabled} />
      )}
    </>
  );
}

/** ตาราง Step Payment (ค่างวดต่อช่วง) — แยกออกมาให้วางตำแหน่งเองได้ (เช่น ล่างสุดของ section) */
export function StepPaymentTable({ stepPhases, onPhasesChange, disabled = false }: {
  stepPhases: StepPhase[] | null | undefined;
  onPhasesChange: (phases: StepPhase[] | null) => void;
  disabled?: boolean;
}) {
  const phases = stepPhases ?? [];
  return (
    <div className="md:col-span-3">
      <FieldLabel className="text-red-600">STEP PAYMENT — ค่างวดต่อช่วง (เพิ่มใหม่)</FieldLabel>
      <div className="border border-line rounded overflow-hidden">
        <table className="table-base text-xs w-full">
          <thead>
            <tr>
              <th className="text-left px-2 py-1 w-14">ช่วงที่</th>
              <th className="text-right px-2 py-1">ตั้งแต่งวดที่</th>
              <th className="text-right px-2 py-1">ค่างวด/เดือน (บาท)</th>
              <th className="px-2 py-1 w-10" />
            </tr>
          </thead>
          <tbody>
            {phases.map((ph, idx) => (
              <tr key={idx}>
                <td className="px-2 py-1 text-muted">{idx + 1}</td>
                <td className="px-2 py-1">
                  <NumInput value={ph.fromPeriod ?? 0} readOnly={disabled} className="text-right tabular-nums"
                    onChange={(v) => { const arr = [...phases]; arr[idx] = { ...arr[idx], fromPeriod: v > 0 ? Math.floor(v) : 1 }; onPhasesChange(arr); }} />
                </td>
                <td className="px-2 py-1">
                  <NumInput value={ph.installment ?? 0} readOnly={disabled} className="text-right tabular-nums"
                    onChange={(v) => { const arr = [...phases]; arr[idx] = { ...arr[idx], installment: v > 0 ? v : 0 }; onPhasesChange(arr); }} />
                </td>
                <td className="px-2 py-1 text-center">
                  <button type="button" title="ลบช่วง" className="text-danger hover:text-red-700 font-bold"
                    onClick={() => { const arr = phases.filter((_, i) => i !== idx); onPhasesChange(arr.length ? arr : null); }}>✕</button>
                </td>
              </tr>
            ))}
            {phases.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-2 text-center text-muted italic">ยังไม่มีช่วง — กด "+ เพิ่มช่วง"</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" className="mt-2 text-brand text-xs hover:underline"
        onClick={() => { const arr = [...phases]; const nextFrom = arr.length ? (arr[arr.length - 1].fromPeriod + 1) : 1; arr.push({ fromPeriod: nextFrom, installment: 0 }); onPhasesChange(arr); }}>
        + เพิ่มช่วง
      </button>
      <p className="text-[10px] text-red-600 mt-1 italic">
        ระบุค่างวดต่อช่วง เช่น ตั้งแต่งวด 1 = 35,000 · ตั้งแต่งวด 13 = 50,000 · งวดสุดท้ายระบบปรับยอดปิดให้เหลือ 0 อัตโนมัติ
      </p>
    </div>
  );
}
