// ClassificationCard — Financial Segment UI block
// Per MoM_Loan_Lease_Workshop §6 + meeting transcript cascade pattern:
//   MA       → Subsidiary picker · RPT badge (auto-derive)
//   CA       → Class default · inherit Subsidiary/RPT
//   Trans    → Department + Location pickers · inherit + override
//
// Pattern: reusable section — drop into MA/CA/Loan/Lease/PN/FP/OD/TR Detail pages

import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { LookupSegmentModal, type SegmentType } from './LookupSegmentModal';
import { supabase } from '@/lib/supabase';
import { deriveRPT, type RPTType } from '@/lib/segment-lookup';

export type ClassificationLevel = 'ma' | 'ca' | 'transaction';

interface FieldVal {
  id: string | null;
  code?: string;
  name?: string;
}

interface Props {
  level: ClassificationLevel;
  // current values
  subsidiary?: FieldVal | null;
  department?: FieldVal | null;
  location?: FieldVal | null;
  klass?: FieldVal | null;
  rpt?: RPTType | null;
  // inherited from parent (read-only display)
  inherited?: {
    subsidiary?: FieldVal;
    klass?: FieldVal;
    rpt?: RPTType;
  };
  // callbacks (only fields editable at this level)
  onSubsidiaryChange?: (v: FieldVal | null) => void;
  onDepartmentChange?: (v: FieldVal | null) => void;
  onLocationChange?: (v: FieldVal | null) => void;
  onClassChange?: (v: FieldVal | null) => void;
  onRPTChange?: (v: RPTType | null) => void;
  // for RPT auto-derive — pass vendor_id (from MA.finance_institution_id)
  lenderVendorId?: string | null;
  disabled?: boolean;
}

export function ClassificationCard({
  level,
  subsidiary,
  department,
  location,
  klass,
  rpt,
  inherited,
  onSubsidiaryChange,
  onDepartmentChange,
  onLocationChange,
  onClassChange,
  onRPTChange,
  lenderVendorId,
  disabled = false,
}: Props) {
  const [picker, setPicker] = useState<SegmentType | null>(null);
  const [derivedRPT, setDerivedRPT] = useState<RPTType | null>(rpt ?? null);

  // Auto-derive RPT from Lender vendor at MA level (if vendor_id available)
  useEffect(() => {
    if (level !== 'ma' || !lenderVendorId) return;
    (async () => {
      const { data } = await supabase
        .from('vendors')
        .select('vendor_type')
        .eq('id', lenderVendorId)
        .maybeSingle();
      const auto = deriveRPT(data?.vendor_type);
      setDerivedRPT(auto);
      onRPTChange?.(auto);
    })();
  }, [level, lenderVendorId]);

  const handleSelect = (item: { id: string; code: string; name: string }) => {
    const v = { id: item.id, code: item.code, name: item.name };
    if (picker === 'subsidiary')      onSubsidiaryChange?.(v);
    else if (picker === 'department') onDepartmentChange?.(v);
    else if (picker === 'location')   onLocationChange?.(v);
    else if (picker === 'class')      onClassChange?.(v);
    setPicker(null);
  };

  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Classification</h3>
        <span className="text-[10px] text-muted italic">
          Financial Segment สำหรับลงบัญชี GL
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* SUBSIDIARY — editable at MA · read-only display at CA/Transaction (legal lock จาก MA) */}
        {(level === 'ma' || inherited?.subsidiary || subsidiary) && (
          <FieldRow
            label="Subsidiary *"
            required
            tooltip={level === 'ma' ? 'บริษัทย่อยที่เป็นเจ้าของสัญญา' : 'บริษัทย่อย — ดึงจาก Master Agreement'}
            value={level === 'ma' ? subsidiary : (inherited?.subsidiary ?? subsidiary)}
            editable={level === 'ma' && !disabled}
            onPick={() => setPicker('subsidiary')}
            inherited={level !== 'ma'}
            readOnlyStyle={level !== 'ma'}
          />
        )}

        {/* RPT — เฉพาะ Transaction · per MoM "Loan ในกลุ่ม vs Loan แบ่ง" */}
        {level === 'transaction' && (
          <div>
            <div className="flex items-center gap-1 mb-1">
              <label className="text-[11px] uppercase text-muted font-medium">Related Parties *</label>
              <span className="relative group inline-flex">
                <span className="text-muted cursor-help text-[10px] hover:text-brand-700">ⓘ</span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50
                             whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-white shadow-lg
                             opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  default จาก Lender (vendor_type) · เลือก override ได้
                </span>
              </span>
            </div>
            <select
              className="w-full rounded border border-line bg-white px-2 py-1.5 text-sm"
              value={(rpt ?? derivedRPT) ?? ''}
              onChange={(e) => {
                const v = (e.target.value || null) as RPTType | null;
                setDerivedRPT(v);
                onRPTChange?.(v);
              }}
              disabled={disabled}
            >
              <option value="">— เลือก —</option>
              <option value="External">External (ภายนอกกลุ่ม)</option>
              <option value="In-group">In-group (ในกลุ่ม)</option>
              <option value="Other">Other</option>
            </select>
            {derivedRPT && !rpt && (
              <p className="text-[10px] text-muted mt-0.5 italic">⚙ Auto จาก Lender: {derivedRPT}</p>
            )}
          </div>
        )}

        {/* CLASS — default at CA · override at Transaction */}
        {(level === 'ca' || level === 'transaction') && (
          <FieldRow
            label="Class (Business Type)"
            tooltip="ประเภทธุรกิจสำหรับลงบัญชี"
            value={klass ?? inherited?.klass}
            editable={!disabled}
            onPick={() => setPicker('class')}
            inherited={level === 'transaction' && !klass}
          />
        )}

        {/* DEPARTMENT — Transaction-level */}
        {level === 'transaction' && (
          <FieldRow
            label="Department"
            tooltip="หน่วยงานที่รับผิดชอบ"
            value={department}
            editable={!disabled}
            onPick={() => setPicker('department')}
          />
        )}

        {/* LOCATION — Transaction-level */}
        {level === 'transaction' && (
          <FieldRow
            label="Location *"
            required
            tooltip="สถานที่ทำธุรกรรม"
            value={location}
            editable={!disabled}
            onPick={() => setPicker('location')}
          />
        )}
      </div>

      <div className="mt-2 text-[11px] text-muted italic">
        {level === 'ma' && '⏬ Subsidiary + RPT จะ inherit ลงไปยัง CA + Transaction'}
        {level === 'ca' && '⏬ Class จะ default ลงไปยัง Transaction (override ได้)'}
        {level === 'transaction' && '✏ ระบุ Department + Location สำหรับการเบิกครั้งนี้'}
      </div>

      {picker && (
        <LookupSegmentModal
          open={true}
          segmentType={picker}
          onClose={() => setPicker(null)}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Sub-component: FieldRow
// ───────────────────────────────────────────────────────────────────
function FieldRow({
  label,
  required = false,
  tooltip,
  value,
  badge,
  editable,
  onPick,
  inherited = false,
  readOnlyStyle = false,
}: {
  label: string;
  required?: boolean;
  tooltip?: string;
  value?: FieldVal | null;
  badge?: string | null;
  editable: boolean;
  onPick?: () => void;
  inherited?: boolean;
  readOnlyStyle?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <label className="text-[11px] uppercase text-muted font-medium">{label}</label>
        {tooltip && (
          <span className="relative group inline-flex">
            <span className="text-muted cursor-help text-[10px] hover:text-brand-700">ⓘ</span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50
                         whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[11px] text-white shadow-lg
                         opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {tooltip}
            </span>
          </span>
        )}
        {inherited && <Badge variant="default" className="text-[9px]">inherited</Badge>}
      </div>

      {badge !== undefined ? (
        <div className="py-1">
          {badge ? (
            <Badge variant={badge === 'In-group' ? 'success' : 'brand'}>{badge}</Badge>
          ) : (
            <span className="text-muted text-xs italic">—</span>
          )}
        </div>
      ) : readOnlyStyle ? (
        // Display-only mode (e.g., Subsidiary at Transaction — locked จาก MA, ไม่มีปุ่ม picker)
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-soft/40 border border-dashed border-line/60">
          <span className="flex-1 text-sm">
            {value?.name ? (
              <span className="font-medium">{value.name}</span>
            ) : (
              <span className="text-muted italic text-xs">— ดึงจาก MA ไม่สำเร็จ —</span>
            )}
          </span>
          <span className="text-[10px] text-muted">🔒</span>
        </div>
      ) : (
        <div className={`flex items-center gap-2 rounded border ${editable ? 'border-line bg-white' : 'border-line bg-soft'} px-2 py-1.5`}>
          <span className="flex-1 text-sm">
            {value?.name ? (
              <>
                <span className="font-mono text-xs text-muted">{value.code}</span>
                <span className="ml-2">{value.name}</span>
              </>
            ) : (
              <span className="text-muted italic">— ไม่ระบุ —</span>
            )}
          </span>
          {editable && onPick && (
            <Button size="sm" variant="ghost" onClick={onPick} className="!px-2">
              <Search size={14} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
