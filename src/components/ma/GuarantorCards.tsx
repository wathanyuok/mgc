import { Plus, X } from 'lucide-react';
import { Button, Input, Select , FieldLabel} from '@/components/ui';
import { useReadOnly } from '@/lib/readonly';

export const GUAR_TYPES = ['บุคคลค้ำประกัน', 'นิติบุคคลค้ำประกัน'] as const;

export interface Guarantor {
  id: string;
  type: (typeof GUAR_TYPES)[number];
  fields: {
    name?: string;
    position?: string;
    company?: string;
    amount?: number;
    expiry_date?: string;
    tax_id?: string;
    phone?: string;
    address?: string;
  };
}

export function newGuarantor(): Guarantor {
  return { id: crypto.randomUUID(), type: 'บุคคลค้ำประกัน', fields: {} };
}

export function GuarantorCards({
  items,
  onChange,
}: {
  items: Guarantor[];
  onChange: (n: Guarantor[]) => void;
}) {
  const upd = (i: number, key: keyof Guarantor['fields'], val: any) =>
    onChange(items.map((x, j) => (j === i ? { ...x, fields: { ...x.fields, [key]: val } } : x)));
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
                          value={g.fields.company ?? ''}
                          onChange={(e) => upd(i, 'company', e.target.value)}
                          placeholder="ชื่อนิติบุคคล"
                        />
                      </div>
                      <div>
                        <FieldLabel required>TAX ID (เลขทะเบียนนิติบุคคล)</FieldLabel>
                        <Input
                          value={g.fields.tax_id ?? ''}
                          onChange={(e) => upd(i, 'tax_id', e.target.value)}
                          placeholder="0107536000676"
                          maxLength={13}
                        />
                      </div>
                      <div>
                        <FieldLabel required>AUTHORIZED SIGNATORY</FieldLabel>
                        <Input
                          value={g.fields.name ?? ''}
                          onChange={(e) => upd(i, 'name', e.target.value)}
                          placeholder="ผู้มีอำนาจลงนาม"
                        />
                      </div>
                      <div>
                        <FieldLabel>POSITION</FieldLabel>
                        <Input
                          value={g.fields.position ?? ''}
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
                          value={g.fields.name ?? ''}
                          onChange={(e) => upd(i, 'name', e.target.value)}
                          placeholder="ชื่อ-นามสกุล"
                        />
                      </div>
                      <div>
                        <FieldLabel required>ID CARD NO (เลขบัตรประชาชน)</FieldLabel>
                        <Input
                          value={g.fields.tax_id ?? ''}
                          onChange={(e) => upd(i, 'tax_id', e.target.value)}
                          placeholder="1100xxxxxxxxx"
                          maxLength={13}
                        />
                      </div>
                      <div>
                        <FieldLabel>POSITION</FieldLabel>
                        <Input
                          value={g.fields.position ?? ''}
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
                      value={g.fields.amount ?? ''}
                      onChange={(e) => upd(i, 'amount', parseFloat(e.target.value) || 0)}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div>
                    <FieldLabel>EXPIRY DATE</FieldLabel>
                    <Input
                      type="date"
                      value={g.fields.expiry_date ?? ''}
                      onChange={(e) => upd(i, 'expiry_date', e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>PHONE</FieldLabel>
                    <Input
                      value={g.fields.phone ?? ''}
                      onChange={(e) => upd(i, 'phone', e.target.value)}
                      placeholder="02-123-4567"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <FieldLabel>{isCorp ? 'ADDRESS (ที่อยู่จดทะเบียน)' : 'ADDRESS'}</FieldLabel>
                    <textarea
                      className="input min-h-[70px]"
                      value={g.fields.address ?? ''}
                      onChange={(e) => upd(i, 'address', e.target.value)}
                      placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
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
