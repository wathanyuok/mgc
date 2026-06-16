/**
 * FacilityPicker — dropdown to pick a contract (Loan/PN/HP/Lease/FP/OD/TR/FXF/LG/LC)
 * by friendly identifier (loan_no, pn_number, lease_no, etc.) instead of pasting UUID.
 *
 * Used in BankStatementDetail when linking a bank line to a facility+period —
 * matches MoM intent that users work with contract numbers, not internal UUIDs.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Select } from '@/components/ui';

export type FacilityType =
  | 'P/N' | 'LG' | 'LC' | 'FP' | 'OD' | 'TR' | 'FXF' | 'Loan' | 'HP' | 'Lease';

interface FacilityConfig {
  table: string;
  labelCol: string;
  /** Extra Supabase filter, applied via .eq() */
  filter?: Record<string, any>;
}

// Map facility type → DB table + user-friendly label column.
const CONFIG: Record<FacilityType, FacilityConfig> = {
  'Loan':  { table: 'loans',              labelCol: 'loan_no' },
  'P/N':   { table: 'promissory_notes',   labelCol: 'pn_number' },
  'HP':    { table: 'leases',             labelCol: 'lease_no', filter: { mode: 'hp' } },
  'Lease': { table: 'leases',             labelCol: 'lease_no', filter: { mode: 'other' } },
  'FP':    { table: 'floor_plans',        labelCol: 'fp_no' },
  'OD':    { table: 'overdrafts',         labelCol: 'od_no' },
  'TR':    { table: 'trust_receipts',     labelCol: 'tr_no' },
  'FXF':   { table: 'fx_forwards',        labelCol: 'fxf_no' },
  'LG':    { table: 'letter_guarantees',  labelCol: 'lg_no' },
  'LC':    { table: 'letter_of_credit',   labelCol: 'lc_no' },
};

interface Props {
  facilityType: FacilityType;
  value: string | null;
  onChange: (uuid: string | null) => void;
  className?: string;
  placeholder?: string;
}

export function FacilityPicker({ facilityType, value, onChange, className, placeholder }: Props) {
  const cfg = CONFIG[facilityType];
  const { data: options = [], isLoading } = useQuery({
    queryKey: ['facility-picker', facilityType],
    enabled: !!cfg,
    queryFn: async () => {
      const select = `id, ${cfg.labelCol}`;
      let q = supabase.from(cfg.table).select(select).order(cfg.labelCol);
      if (cfg.filter) {
        for (const [k, v] of Object.entries(cfg.filter)) q = q.eq(k, v);
      }
      const { data, error } = await q;
      if (error) {
        // Some tables may not exist yet in older DB snapshots — degrade gracefully.
        console.warn(`[FacilityPicker] ${facilityType} (${cfg.table}) failed:`, error.message);
        return [] as { id: string; label: string }[];
      }
      return (data ?? []).map((r: any) => ({
        id: r.id as string,
        label: (r[cfg.labelCol] as string) ?? '(no label)',
      }));
    },
  });

  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={className}
      title={placeholder ?? `เลือก ${facilityType}`}
    >
      <option value="">{isLoading ? '...' : (placeholder ?? `— เลือก ${facilityType} —`)}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
      {/* Preserve unknown UUID (e.g. orphaned record after delete) so it doesn't silently change */}
      {value && !options.some((o) => o.id === value) && (
        <option value={value}>⚠ {value.slice(0, 8)}… (not found)</option>
      )}
    </Select>
  );
}
