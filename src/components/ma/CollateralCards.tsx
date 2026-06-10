import { AlertTriangle, Plus, X } from 'lucide-react';
import { Button, Input, Select, FieldLabel, NumInput } from '@/components/ui';
import { useReadOnly } from '@/lib/readonly';

export type CollateralType = 'none' | 'realestate' | 'vehicle' | 'deposit' | 'business' | 'other';

export const COL_TYPE_OPTIONS: [CollateralType, string][] = [
  ['none', '-- ไม่มี --'],
  ['realestate', 'ที่ดิน/อสังหาริมทรัพย์'],
  ['vehicle', 'ยานพาหนะ'],
  ['deposit', 'เงินฝากธนาคาร'],
  ['business', 'หลักประกันทางธุรกิจ'],
  ['other', 'อื่น ๆ'],
];

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'num' | 'date';
}

export const COLLATERAL_FIELDS: Record<CollateralType, FieldDef[]> = {
  none: [],
  realestate: [
    { key: 'doc_no', label: 'DOCUMENT NO', type: 'text' },
    { key: 'location', label: 'LOCATION', type: 'text' },
    { key: 'value', label: 'VALUE', type: 'num' },
    { key: 'appraisal', label: 'APPRAISAL VALUE', type: 'num' },
    { key: 'appr_date', label: 'APPRAISAL DATE', type: 'date' },
    { key: 'mortgage_limit', label: 'MORTGAGE LIMIT', type: 'num' },
  ],
  vehicle: [
    { key: 'vreg', label: 'VEHICLE REG NO', type: 'text' },
    { key: 'vmodel', label: 'MODEL / YEAR', type: 'text' },
    { key: 'value', label: 'VALUE', type: 'num' },
    { key: 'appraisal', label: 'APPRAISAL VALUE', type: 'num' },
    { key: 'appr_date', label: 'APPRAISAL DATE', type: 'date' },
    { key: 'pledge', label: 'PLEDGE AMOUNT', type: 'num' },
  ],
  deposit: [
    { key: 'bank', label: 'BANK', type: 'text' },
    { key: 'acct_no', label: 'ACCOUNT NO', type: 'text' },
    { key: 'acct_name', label: 'ACCOUNT NAME', type: 'text' },
    { key: 'deposit_amt', label: 'DEPOSIT AMOUNT', type: 'num' },
    { key: 'pledge_amt', label: 'PLEDGE AMOUNT', type: 'num' },
  ],
  business: [
    { key: 'desc', label: 'COLLATERAL DESCRIPTION', type: 'text' },
    { key: 'reg_no', label: 'REGISTRATION NO', type: 'text' },
    { key: 'value', label: 'VALUE', type: 'num' },
    { key: 'appraisal', label: 'APPRAISAL VALUE', type: 'num' },
    { key: 'appr_date', label: 'APPRAISAL DATE', type: 'date' },
    { key: 'reg_limit', label: 'REGISTERED LIMIT', type: 'num' },
  ],
  other: [
    { key: 'desc', label: 'DESCRIPTION', type: 'text' },
    { key: 'value', label: 'VALUE', type: 'num' },
    { key: 'appraisal', label: 'APPRAISAL VALUE', type: 'num' },
    { key: 'appr_date', label: 'APPRAISAL DATE', type: 'date' },
    { key: 'secured_limit', label: 'SECURED LIMIT', type: 'num' },
  ],
};

const VALUE_INFO: Partial<Record<CollateralType, { source: string; frequency: string }>> = {
  deposit: { source: 'Deposit Master', frequency: 'Real-time · ดอกเบี้ยทบรายวัน + ฝาก/ถอน' },
  vehicle: { source: 'FA Master (Chassis Register)', frequency: 'Event-based · เมื่อขายรถออกจาก stock' },
  realestate: { source: 'FA (Book Value) + External Appraiser', frequency: 'Periodic · Revaluation ทุก 1-3 ปี' },
  business: { source: 'FA / AR / Inventory', frequency: 'Monthly · Depreciation + AR aging' },
};

export interface Collateral {
  id: string;
  type: CollateralType;
  fields: Record<string, any>;
}

export function newCollateral(type: CollateralType = 'realestate'): Collateral {
  return { id: crypto.randomUUID(), type, fields: {} };
}

export function CollateralCards({
  items,
  onChange,
}: {
  items: Collateral[];
  onChange: (n: Collateral[]) => void;
}) {
  const ro = useReadOnly();
  return (
    <div>
      {items.length === 0 && (
        <div className="text-center text-muted py-6">ยังไม่มี Collateral — กด "+ Add Collateral"</div>
      )}
      <div className="space-y-4">
        {items.map((c, i) => {
          // AC-NTF-002 — Red highlight when value < appraisal × 0.9 (มูลค่าลดลง > 10%)
          const value = Number(c.fields.value ?? 0);
          const appraisal = Number(c.fields.appraisal ?? 0);
          const isDropped = appraisal > 0 && value > 0 && value < appraisal * 0.9;
          const dropPct = isDropped ? ((1 - value / appraisal) * 100).toFixed(1) : '0';

          return (
          <div
            key={c.id}
            className={`border rounded p-4 ${
              isDropped
                ? 'border-red-300 bg-red-50'
                : 'border-line bg-soft'
            }`}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-brand">Collateral #{i + 1}</div>
                {isDropped && (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded"
                    title={`มูลค่า ${value.toLocaleString()} ต่ำกว่าราคาประเมิน ${appraisal.toLocaleString()} (drop ${dropPct}%) — กระทบ Coverage/วงเงิน (AC-NTF-002)`}
                  >
                    <AlertTriangle className="w-3 h-3" /> Value drop {dropPct}%
                  </span>
                )}
              </div>
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

            <div className="mb-3">
              <FieldLabel required>COLLATERAL TYPE</FieldLabel>
              <Select
                value={c.type}
                onChange={(e) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, type: e.target.value as CollateralType, fields: {} } : x)))
                }
                className="max-w-xs"
              >
                {COL_TYPE_OPTIONS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            {VALUE_INFO[c.type] && (
              <div className="bg-brand-light border-l-4 border-brand text-xs text-ink px-3 py-2 rounded mb-3">
                📊 <strong>มูลค่าเปลี่ยนตามเวลา</strong> · {VALUE_INFO[c.type]!.source} · {VALUE_INFO[c.type]!.frequency}
              </div>
            )}

            {c.type === 'none' ? (
              <div className="italic text-muted text-sm py-3">— ไม่ได้ระบุหลักประกัน —</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {COLLATERAL_FIELDS[c.type].map((f) => (
                  <div key={f.key}>
                    <FieldLabel>{f.label}</FieldLabel>
                    {f.type === 'num' ? (
                      <NumInput
                        value={Number(c.fields[f.key] ?? 0)}
                        onChange={(n) =>
                          onChange(
                            items.map((x, j) =>
                              j === i ? { ...x, fields: { ...x.fields, [f.key]: n } } : x,
                            ),
                          )
                        }
                      />
                    ) : f.type === 'date' ? (
                      <Input
                        type="date"
                        value={c.fields[f.key] ?? ''}
                        onChange={(e) =>
                          onChange(
                            items.map((x, j) => (j === i ? { ...x, fields: { ...x.fields, [f.key]: e.target.value } } : x)),
                          )
                        }
                      />
                    ) : (
                      <Input
                        value={c.fields[f.key] ?? ''}
                        onChange={(e) =>
                          onChange(
                            items.map((x, j) => (j === i ? { ...x, fields: { ...x.fields, [f.key]: e.target.value } } : x)),
                          )
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
      {!ro && (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => onChange([...items, newCollateral()])}>
          <Plus className="w-4 h-4" /> Add Collateral
        </Button>
      )}
    </div>
  );
}
