import { Plus, X } from 'lucide-react';
import { Button, Input, Select , FieldLabel} from '@/components/ui';
import { useReadOnly } from '@/lib/readonly';
import { digitsOnly, thaiIdError, isValidThaiId } from '@/lib/thai-id';

export const GUAR_TYPES = ['บุคคลค้ำประกัน', 'นิติบุคคลค้ำประกัน'] as const;

// Column-based structure — 1:1 กับ ma_guarantors table (migration 0066)
export interface Guarantor {
  id: string;
  type: (typeof GUAR_TYPES)[number];
  name?: string;                 // บุคคล = ชื่อ-นามสกุล · นิติบุคคล = ผู้มีอำนาจลงนาม
  company_name?: string;         // เฉพาะนิติบุคคล — ชื่อบริษัท
  id_card_or_tax_id?: string;    // บุคคล = เลข ปชช. / นิติบุคคล = เลขทะเบียนนิติบุคคล
  position?: string;
  amount?: number;
  expiry_date?: string;
  phone?: string;
  address?: string;
  remark?: string;
}

export function newGuarantor(): Guarantor {
  return { id: crypto.randomUUID(), type: 'บุคคลค้ำประกัน' };
}

/** มีผู้ค้ำรายไหนกรอกเลข 13 หลักผิดไหม — ใช้กันไว้ตอน Save */
export function invalidGuarantorIds(items: Guarantor[]): string[] {
  return items
    .map((g, i) => {
      const v = digitsOnly(g.id_card_or_tax_id ?? '');
      if (!v) return null;
      if (isValidThaiId(v)) return null;
      const what = g.type === 'นิติบุคคลค้ำประกัน' ? 'เลขทะเบียนนิติบุคคล' : 'เลขบัตรประชาชน';
      return `ผู้ค้ำประกันรายที่ ${i + 1}: ${what}ไม่ถูกต้อง`;
    })
    .filter(Boolean) as string[];
}

/** ช่องเลข 13 หลัก — รับเฉพาะตัวเลข + ตรวจหลักตรวจสอบทันทีที่กรอกครบ */
function IdNumberField({
  label, thaiLabel, value, onChange,
}: { label: string; thaiLabel: string; value: string; onChange: (v: string) => void }) {
  const digits = digitsOnly(value);
  const err = thaiIdError(digits, thaiLabel);
  const ok = digits.length === 13 && !err;

  return (
    <div>
      <FieldLabel required>{label}</FieldLabel>
      <Input
        value={digits}
        onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 13))}
        placeholder="ตัวเลข 13 หลัก"
        inputMode="numeric"
        maxLength={13}
        className={err ? '[&_input]:!border-red-400' : ok ? '[&_input]:!border-emerald-400' : undefined}
      />
      {err
        ? <p className="mt-1 text-[11px] text-red-600">{err}</p>
        : digits.length > 0 && digits.length < 13
          ? <p className="mt-1 text-[11px] text-gray-400">กรอกแล้ว {digits.length} จาก 13 หลัก</p>
          : ok
            ? <p className="mt-1 text-[11px] text-emerald-600">✓ เลขถูกต้อง</p>
            : null}
    </div>
  );
}

export function GuarantorCards({
  items,
  onChange,
}: {
  items: Guarantor[];
  onChange: (n: Guarantor[]) => void;
}) {
  const upd = <K extends keyof Guarantor>(i: number, key: K, val: Guarantor[K]) =>
    onChange(items.map((x, j) => (j === i ? { ...x, [key]: val } : x)));
  const ro = useReadOnly();

  return (
    <div>
      {items.length === 0 && (
        <div className="text-center text-muted py-6">ยังไม่มี Guarantor — กด "+ Add Guarantor"</div>
      )}
      <div className="space-y-4">
        {items.map((g, i) => (
          <div key={g.id} className="border border-line rounded p-4 bg-soft">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold text-brand">Guarantor #{i + 1}</div>
              {!ro && (
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  className="text-danger hover:underline text-xs flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>

            {(() => {
              const isCorp = g.type === 'นิติบุคคลค้ำประกัน';
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <FieldLabel required>GUARANTOR TYPE</FieldLabel>
                    <Select
                      value={g.type}
                      onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, type: e.target.value as any } : x)))}
                    >
                      {GUAR_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </div>

                  {isCorp ? (
                    <>
                      <div>
                        <FieldLabel required>COMPANY NAME</FieldLabel>
                        <Input
                          value={g.company_name ?? ''}
                          onChange={(e) => upd(i, 'company_name', e.target.value)}
                          placeholder="ชื่อนิติบุคคล"
                        />
                      </div>
                      <IdNumberField
                        label="TAX ID (เลขทะเบียนนิติบุคคล)"
                        thaiLabel="เลขทะเบียนนิติบุคคล"
                        value={g.id_card_or_tax_id ?? ''}
                        onChange={(v) => upd(i, 'id_card_or_tax_id', v)}
                      />
                      <div>
                        <FieldLabel required>AUTHORIZED SIGNATORY</FieldLabel>
                        <Input
                          value={g.name ?? ''}
                          onChange={(e) => upd(i, 'name', e.target.value)}
                          placeholder="ผู้มีอำนาจลงนาม"
                        />
                      </div>
                      <div>
                        <FieldLabel>POSITION</FieldLabel>
                        <Input
                          value={g.position ?? ''}
                          onChange={(e) => upd(i, 'position', e.target.value)}
                          placeholder="กรรมการผู้จัดการ"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <FieldLabel required>NAME</FieldLabel>
                        <Input
                          value={g.name ?? ''}
                          onChange={(e) => upd(i, 'name', e.target.value)}
                          placeholder="ชื่อ-นามสกุล"
                        />
                      </div>
                      <IdNumberField
                        label="ID CARD NO (เลขบัตรประชาชน)"
                        thaiLabel="เลขบัตรประชาชน"
                        value={g.id_card_or_tax_id ?? ''}
                        onChange={(v) => upd(i, 'id_card_or_tax_id', v)}
                      />
                      <div>
                        <FieldLabel>POSITION</FieldLabel>
                        <Input
                          value={g.position ?? ''}
                          onChange={(e) => upd(i, 'position', e.target.value)}
                          placeholder="กรรมการ / ผู้ถือหุ้น"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <FieldLabel required>AMOUNT (บาท)</FieldLabel>
                    <Input
                      type="number"
                      step="0.01"
                      value={g.amount ?? ''}
                      onChange={(e) => upd(i, 'amount', parseFloat(e.target.value) || 0)}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div>
                    <FieldLabel>EXPIRY DATE</FieldLabel>
                    <Input
                      type="date"
                      value={g.expiry_date ?? ''}
                      onChange={(e) => upd(i, 'expiry_date', e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>PHONE</FieldLabel>
                    <Input
                      value={g.phone ?? ''}
                      onChange={(e) => upd(i, 'phone', e.target.value)}
                      placeholder="02-123-4567"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <FieldLabel>{isCorp ? 'ADDRESS (ที่อยู่จดทะเบียน)' : 'ADDRESS'}</FieldLabel>
                    <textarea
                      className="input min-h-[70px]"
                      value={g.address ?? ''}
                      onChange={(e) => upd(i, 'address', e.target.value)}
                      placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <FieldLabel>REMARK</FieldLabel>
                    <textarea
                      className="input min-h-[50px]"
                      value={g.remark ?? ''}
                      onChange={(e) => upd(i, 'remark', e.target.value)}
                      placeholder="หมายเหตุเพิ่มเติม"
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
      {!ro && (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => onChange([...items, newGuarantor()])}>
          <Plus className="w-4 h-4" /> Add Guarantor
        </Button>
      )}
    </div>
  );
}
