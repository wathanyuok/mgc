import { Plus, X } from 'lucide-react';
import { Button, Input, Select , FieldLabel} from '@/components/ui';

export const RATE_TYPES = ['Fixed', 'MLR', 'MMR', 'MOR', 'MRR'] as const;
export const FEE_TYPES = ['Fixed', 'Percentage', 'Tiered'] as const;

export interface RateCard {
  id: string;
  type: string;
  rate: number;
  condition: number;       // margin/spread
  overlimit: number;
  start_date: string | null;
}

export function newRateCard(variant: RateCardsVariant = 'interest'): RateCard {
  return {
    id: crypto.randomUUID(),
    type: variant === 'fee' ? 'Fixed' : 'MLR',
    rate: 0,
    condition: 0,
    overlimit: 0,
    start_date: null,
  };
}

export function effectiveRate(c: RateCard): number {
  return (c.rate || 0) + (c.condition || 0);
}

export type RateCardsVariant = 'interest' | 'fee';

const VARIANT_LABELS = {
  interest: {
    cardTitle: 'Interest Rate',
    type: 'INTEREST TYPE',
    rate: 'INTEREST RATE (%)',
    condition: 'INTEREST RATE CONDITION (%)',
    overlimit: 'OVERLIMIT / CLEAN OVERDRAW (%)',
    startDate: 'INTEREST START DATE',
    addBtn: 'Add Interest Rate',
    emptyMsg: 'ยังไม่มี Interest Rate — กด "+ Add Interest Rate"',
  },
  fee: {
    cardTitle: 'Fee Rate',
    type: 'FEE TYPE',
    rate: 'FEE RATE (%)',
    condition: 'FEE RATE CONDITION (%)',
    overlimit: 'OVERLIMIT / OVER FEE (%)',
    startDate: 'FEE START DATE',
    addBtn: 'Add Fee Rate',
    emptyMsg: 'ยังไม่มี Fee Rate — กด "+ Add Fee Rate"',
  },
};

export function RateCards({
  rates,
  onChange,
  variant = 'interest',
}: {
  rates: RateCard[];
  onChange: (n: RateCard[]) => void;
  variant?: RateCardsVariant;
}) {
  const L = VARIANT_LABELS[variant];
  const typeOptions = variant === 'fee' ? FEE_TYPES : RATE_TYPES;
  const isFee = variant === 'fee';

  return (
    <div>
      {rates.length === 0 && <div className="text-center text-muted py-6">{L.emptyMsg}</div>}
      <div className="space-y-4">
        {rates.map((r, i) => (
          <div key={r.id} className="border border-line rounded p-4 bg-soft">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold text-brand">
                {L.cardTitle} #{i + 1}
              </div>
              <button
                type="button"
                onClick={() => onChange(rates.filter((_, j) => j !== i))}
                className="text-danger hover:underline text-xs flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Remove
              </button>
            </div>

            {isFee ? (
              /* ─── FEE variant: only 3 fields per HTML ─── */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <FieldLabel required>{L.type}</FieldLabel>
                  <Select
                    value={r.type}
                    onChange={(e) => onChange(rates.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  >
                    {typeOptions.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel required>{L.rate}</FieldLabel>
                  <Input
                    type="number"
                    step="0.0001"
                    value={r.rate}
                    onChange={(e) =>
                      onChange(rates.map((x, j) => (j === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x)))
                    }
                    placeholder="1.50"
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldLabel>{L.condition}</FieldLabel>
                  <Input
                    type="number"
                    step="0.0001"
                    value={r.condition}
                    onChange={(e) =>
                      onChange(rates.map((x, j) => (j === i ? { ...x, condition: parseFloat(e.target.value) || 0 } : x)))
                    }
                    placeholder="1.50"
                  />
                </div>
              </div>
            ) : (
              /* ─── INTEREST variant: full 5 fields + effective pill ─── */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
                <div className="space-y-3">
                  <div>
                    <FieldLabel required>{L.type}</FieldLabel>
                    <Select
                      value={r.type}
                      onChange={(e) => onChange(rates.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                    >
                      {typeOptions.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FieldLabel>{L.condition}</FieldLabel>
                    <Input
                      type="number"
                      step="0.0001"
                      value={r.condition}
                      onChange={(e) =>
                        onChange(rates.map((x, j) => (j === i ? { ...x, condition: parseFloat(e.target.value) || 0 } : x)))
                      }
                      placeholder="-1.55"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <FieldLabel required>{L.rate}</FieldLabel>
                    <Input
                      type="number"
                      step="0.0001"
                      value={r.rate}
                      onChange={(e) =>
                        onChange(rates.map((x, j) => (j === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x)))
                      }
                      placeholder="5.6000"
                    />
                  </div>
                  <div>
                    <FieldLabel>{L.overlimit}</FieldLabel>
                    <Input
                      type="number"
                      step="0.0001"
                      value={r.overlimit}
                      onChange={(e) =>
                        onChange(rates.map((x, j) => (j === i ? { ...x, overlimit: parseFloat(e.target.value) || 0 } : x)))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <FieldLabel required>{L.startDate}</FieldLabel>
                    <Input
                      type="date"
                      value={r.start_date ?? ''}
                      onChange={(e) =>
                        onChange(rates.map((x, j) => (j === i ? { ...x, start_date: e.target.value || null } : x)))
                      }
                      className={!r.start_date ? 'border-danger' : ''}
                    />
                    {!r.start_date && (
                      <p className="text-[10px] text-danger mt-0.5">⚠ ต้องระบุ — สำคัญต่อ audit + multi-rate calc</p>
                    )}
                  </div>
                  <div className="pt-1">
                    <div className="bg-brand-light text-brand text-xs px-3 py-2 rounded text-right font-semibold tabular-nums">
                      Effective: {effectiveRate(r).toFixed(4)}%
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Button
        variant="primary"
        size="sm"
        className="mt-3"
        onClick={() => onChange([...rates, newRateCard(variant)])}
      >
        <Plus className="w-4 h-4" /> {L.addBtn}
      </Button>
    </div>
  );
}
