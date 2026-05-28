import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge , FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  type MasterAgreement,
  type MASubsidiary,
  type MACondition,
  type MACollateral,
  type MAGuarantor,
  type CreditAgreement,
  FINANCE_INSTITUTIONS,
  SUBSIDIARIES,
  SUB_SHORT,
  MA_STATUS,
  RATIO_OPS,
} from '@/types/database';
import { TOOLTIPS } from '@/lib/tooltips';
import { useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { CollateralCards, type Collateral, type CollateralType } from '@/components/ma/CollateralCards';
import { GuarantorCards, type Guarantor } from '@/components/ma/GuarantorCards';
import { DocumentTab } from '@/components/ma/DocumentTab';

type TabKey = 'condition' | 'collateral' | 'guarantee' | 'details' | 'files';

// =====================================================================
// MA Detail — of
// =====================================================================
export function MADetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('details');
  const [openPrim, setOpenPrim] = useState(true);
  const [openCredit, setOpenCredit] = useState(true);

  // ---------- form state ----------
  const [ma, setMa] = useState<MasterAgreement>({
    id: '',
    inactive: false,
    finance_institution: 'KBANK',
    ma_name: '',
    subsidiary: SUBSIDIARIES[1],
    status: 'Draft',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    credit_line: 0,
    utilization: 0,
    remaining_credit: 0,
    created_at: '',
    updated_at: '',
  });
  const [subs, setSubs] = useState<MASubsidiary[]>([]);
  const [cond, setCond] = useState<MACondition>({
    ma_id: '',
    de_op: '<=',
    de_value: 4.0,
    dscr_op: '>=',
    dscr_value: 1.2,
    other_requirement: '',
    consent_waiver: '',
  });

  const [collaterals, setCollaterals] = useState<Collateral[]>([]);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [guarRemark, setGuarRemark] = useState('');

  // ---------- fetch existing ----------
  const { data: existing } = useQuery({
    queryKey: ['ma', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [maRes, subsRes, condRes, casRes, colRes, guarRes] = await Promise.all([
        supabase.from('master_agreements').select('*').eq('id', id!).single(),
        supabase.from('ma_subsidiaries').select('*').eq('ma_id', id!).order('sort_order'),
        supabase.from('ma_conditions').select('*').eq('ma_id', id!).maybeSingle(),
        supabase.from('credit_agreements').select('*').eq('ma_id', id!).order('ca_name'),
        supabase.from('ma_collaterals').select('*').eq('ma_id', id!).order('sort_order'),
        supabase.from('ma_guarantors').select('*').eq('ma_id', id!).order('sort_order'),
      ]);
      if (maRes.error) throw maRes.error;
      return {
        ma: maRes.data as MasterAgreement,
        subs: (subsRes.data ?? []) as MASubsidiary[],
        cond: (condRes.data ?? null) as MACondition | null,
        cas: (casRes.data ?? []) as CreditAgreement[],
        cols: (colRes.data ?? []) as MACollateral[],
        guars: (guarRes.data ?? []) as MAGuarantor[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      setMa(existing.ma);
      setSubs(existing.subs);
      if (existing.cond) setCond(existing.cond);
      setCollaterals(
        existing.cols.map((c) => ({ id: c.id, type: c.type as CollateralType, fields: c.fields ?? {} })),
      );
      setGuarantors(
        existing.guars.map((g) => ({ id: g.id, type: g.type as any, fields: g.fields ?? {} })),
      );
      // guarRemark is stored in MA-level field or condition? In HTML it's a separate textarea on Guarantee tab.
      // For now, store in ma_conditions.consent_waiver or a separate column — using a simple workaround.
    }
  }, [existing]);

  // ---------- live computations ----------
  const subTotal = useMemo(() => subs.reduce((s, x) => s + (x.credit_line || 0), 0), [subs]);
  const subUtilTotal = useMemo(() => subs.reduce((s, x) => s + (x.utilization || 0), 0), [subs]);
  // Σ sub-allocation ต้อง "ไม่เกิน" credit line (จัดสรรน้อยกว่าได้ — เหลือ headroom) — ไม่บังคับให้เท่ากัน
  const subAllocOK = useMemo(() => subTotal <= (ma.credit_line || 0) + 0.01, [subTotal, ma.credit_line]);
  const userLabel = useCurrentUserLabel();
  const readOnly = useReadOnly();

  // ---------- ensure MA exists (used before upload in "new" mode) ----------
  // Returns the MA id; auto-saves a draft if MA hasn't been persisted yet.
  const ensureMaId = async (): Promise<string> => {
    if (id) return id;
    // Auto-save draft so child tabs (Document upload etc.) have a valid ma_id to attach to.
    const name = ma.ma_name.trim() || `DRAFT-${Date.now()}`;
    const { data, error } = await supabase
      .from('master_agreements')
      .insert({
        inactive: ma.inactive,
        finance_institution: ma.finance_institution,
        ma_name: name,
        subsidiary: ma.subsidiary,
        status: 'Draft',
        start_date: ma.start_date,
        end_date: ma.end_date,
        credit_line: ma.credit_line || 0,
        utilization: 0,
        created_by: userLabel,
        updated_by: userLabel,
      })
      .select()
      .single();
    if (error) throw error;
    // Update local form name + status so UI reflects auto-save
    setMa((m) => ({ ...m, ma_name: name, status: 'Draft' }));
    // Switch URL to edit mode without full page reload
    navigate(`/ma/${data.id}`, { replace: true });
    toast.success('✓ สร้าง Draft อัตโนมัติ — สามารถ upload ไฟล์ได้แล้ว');
    return data.id as string;
  };

  // ---------- mutations ----------
  const save = useMutation({
    mutationFn: async () => {
      if (!ma.ma_name.trim()) throw new Error('กรอก Master Agreement Name');

      let maId = id;
      if (mode === 'new') {
        const { data, error } = await supabase
          .from('master_agreements')
          .insert({
            inactive: ma.inactive,
            finance_institution: ma.finance_institution,
            ma_name: ma.ma_name,
            subsidiary: ma.subsidiary,
            status: ma.status,
            start_date: ma.start_date,
            end_date: ma.end_date,
            credit_line: ma.credit_line,
            utilization: subUtilTotal,
            created_by: userLabel,
            updated_by: userLabel,
          })
          .select()
          .single();
        if (error) throw error;
        maId = data.id;
      } else {
        const { error } = await supabase
          .from('master_agreements')
          .update({
            inactive: ma.inactive,
            finance_institution: ma.finance_institution,
            ma_name: ma.ma_name,
            subsidiary: ma.subsidiary,
            status: ma.status,
            start_date: ma.start_date,
            end_date: ma.end_date,
            credit_line: ma.credit_line,
            updated_by: userLabel,
            updated_at: new Date().toISOString(),
          })
          .eq('id', maId!);
        if (error) throw error;
      }

      // Replace subsidiary rows
      await supabase.from('ma_subsidiaries').delete().eq('ma_id', maId!);
      if (subs.length > 0) {
        const { error } = await supabase.from('ma_subsidiaries').insert(
          subs.map((s, i) => ({
            ma_id: maId!,
            subsidiary: s.subsidiary,
            credit_line: s.credit_line,
            utilization: s.utilization,
            sort_order: i,
          })),
        );
        if (error) throw error;
      }

      // Upsert conditions
      const { error: condErr } = await supabase.from('ma_conditions').upsert({ ...cond, ma_id: maId! });
      if (condErr) throw condErr;

      // Replace collateral rows
      await supabase.from('ma_collaterals').delete().eq('ma_id', maId!);
      if (collaterals.length > 0) {
        const { error } = await supabase.from('ma_collaterals').insert(
          collaterals.map((c, i) => ({
            ma_id: maId!,
            type: c.type,
            fields: c.fields,
            sort_order: i,
          })),
        );
        if (error) throw error;
      }

      // Replace guarantor rows
      await supabase.from('ma_guarantors').delete().eq('ma_id', maId!);
      if (guarantors.length > 0) {
        const { error } = await supabase.from('ma_guarantors').insert(
          guarantors.map((g, i) => ({
            ma_id: maId!,
            type: g.type,
            fields: g.fields,
            sort_order: i,
          })),
        );
        if (error) throw error;
      }

      return maId;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['ma-list'] });
      qc.invalidateQueries({ queryKey: ['ma', newId] });
      toast.success(mode === 'new' ? '✓ สร้าง Master Agreement แล้ว' : '✓ บันทึกการแก้ไขแล้ว');
      if (mode === 'new' && newId) navigate(`/ma/${newId}`);
    },
    onError: (e: any) => toast.error(e.message ?? 'Save failed'),
  });

  const titleNo = mode === 'new' ? 'New Master Agreement' : ma.ma_name || 'Loading...';
  const cas = existing?.cas ?? [];

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/ma')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Master Agreement</h1>
          <p className="text-muted text-sm font-medium">{titleNo}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || readOnly} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/ma')}>Cancel</Button>
      </div>

      <AuditFooter
        createdBy={(ma as any).created_by}
        createdAt={(ma as any).created_at}
        updatedBy={(ma as any).updated_by}
        updatedAt={(ma as any).updated_at}
      />

      {/* ========== PRIMARY INFORMATION ========== */}
      <Section title="Primary Information" open={openPrim} onToggle={() => setOpenPrim((o) => !o)}>
        <div className="mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ma.inactive}
              onChange={(e) => setMa((m) => ({ ...m, inactive: e.target.checked }))}
              className="rounded"
            />
            <span className="font-semibold tracking-wide">INACTIVE</span>
            <Help title="ทำเครื่องหมายเพื่อปิดสัญญาชั่วคราว ไม่ใช้งานในระบบ" />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="FINANCE INSTITUTION" required>
            <Select
              value={ma.finance_institution}
              onChange={(e) => setMa((m) => ({ ...m, finance_institution: e.target.value }))}
            >
              {FINANCE_INSTITUTIONS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Field label="STATUS" required>
            <Select value={ma.status} onChange={(e) => setMa((m) => ({ ...m, status: e.target.value as any }))}>
              {MA_STATUS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <div />

          <Field label="MASTER AGREEMENT NAME" required>
            <Input
              value={ma.ma_name}
              onChange={(e) => setMa((m) => ({ ...m, ma_name: e.target.value }))}
              placeholder="MGC-HP-2024-001"
            />
          </Field>
          <Field label="START DATE" required>
            <Input type="date" value={ma.start_date} onChange={(e) => setMa((m) => ({ ...m, start_date: e.target.value }))} />
          </Field>
          <div />

          <Field label="SUBSIDIARY" required>
            <Select
              value={ma.subsidiary}
              onChange={(e) => setMa((m) => ({ ...m, subsidiary: e.target.value }))}
            >
              {SUBSIDIARIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="END DATE" required>
            <Input type="date" value={ma.end_date} onChange={(e) => setMa((m) => ({ ...m, end_date: e.target.value }))} />
          </Field>
          <div />
        </div>
      </Section>

      {/* ========== CREDIT LINE INFORMATION ========== */}
      <Section title="Credit Line Information" open={openCredit} onToggle={() => setOpenCredit((o) => !o)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="CREDIT LINE" required>
            <NumInput
              value={ma.credit_line}
              onChange={(v) => setMa((m) => ({ ...m, credit_line: v }))}
            />
            {!subAllocOK && subs.length > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠ Σ Sub-allocation ({fmtMoney(subTotal)}) เกิน Credit Line ({fmtMoney(ma.credit_line)}) — จัดสรรรวมต้องไม่เกินวงเงิน
              </p>
            )}
          </Field>
          <Field label="UTILIZATION">
            <Input readOnly value={fmtMoney(subUtilTotal)} className="bg-gray-50 text-right tabular-nums" />
          </Field>
          <Field label="REMAINING CREDIT LINE">
            <Input
              readOnly
              value={fmtMoney(ma.credit_line - subUtilTotal)}
              className="bg-gray-50 text-right tabular-nums"
            />
          </Field>
        </div>

        {/* Parent-Child Subsidiary table */}
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead className="bg-brand text-white">
              <tr>
                <th className="w-16 !text-white !bg-brand"></th>
                <th className="!text-white !bg-brand">Parent-Child (SUBSIDIARY)</th>
                <th className="!text-white !bg-brand text-right">CREDIT LINE</th>
                <th className="!text-white !bg-brand text-right">UTILIZATION</th>
                <th className="!text-white !bg-brand text-right">REMAINING CREDIT LINE</th>
                <th className="w-20 !text-white !bg-brand"></th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-6">
                    ยังไม่มี Sub-allocation — กด "+ Add Subsidiary"
                  </td>
                </tr>
              )}
              {subs.map((s, i) => (
                <tr key={i}>
                  <td>
                    <button type="button" className="text-brand text-xs hover:underline">
                      Edit
                    </button>
                  </td>
                  <td>
                    <Select
                      value={s.subsidiary}
                      onChange={(e) =>
                        setSubs((arr) => arr.map((x, j) => (j === i ? { ...x, subsidiary: e.target.value } : x)))
                      }
                    >
                      {SUB_SHORT.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <NumInput
                      step="0.01"
                      value={s.credit_line}
                      onChange={(v) =>
                        setSubs((arr) =>
                          arr.map((x, j) =>
                            j === i ? { ...x, credit_line: v } : x,
                          ),
                        )
                      }
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td>
                    <NumInput
                      step="0.01"
                      value={s.utilization}
                      onChange={(v) =>
                        setSubs((arr) =>
                          arr.map((x, j) =>
                            j === i ? { ...x, utilization: v } : x,
                          ),
                        )
                      }
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="text-right tabular-nums px-3">
                    {fmtMoney(s.credit_line - s.utilization)}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSubs((arr) => arr.filter((_, j) => j !== i))}
                      className="text-danger text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              setSubs((arr) => [
                ...arr,
                {
                  id: crypto.randomUUID(),
                  ma_id: ma.id,
                  subsidiary: SUB_SHORT[0],
                  credit_line: 0,
                  utilization: 0,
                  remaining: 0,
                  sort_order: arr.length,
                },
              ])
            }
          >
            <Plus className="w-4 h-4" /> Add Subsidiary
          </Button>
        </div>
      </Section>

      {/* ========== TABS ========== */}
      <div className="flex border-b border-line mb-0 mt-6">
        {(
          [
            ['condition', 'Condition'],
            ['collateral', 'Collateral'],
            ['guarantee', 'Guarantee'],
            ['details', 'Details Credit Agreement'],
            ['files', 'Document'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
              tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="rounded-t-none">
        <CardContent>
          {tab === 'condition' && <ConditionPane cond={cond} setCond={setCond} />}
          {tab === 'collateral' && <CollateralCards items={collaterals} onChange={setCollaterals} />}
          {tab === 'guarantee' && (
            <div>
              <GuarantorCards items={guarantors} onChange={setGuarantors} />
              <div className="mt-6">
                <FieldLabel>REMARK</FieldLabel>
                <textarea
                  className="input min-h-[80px]"
                  value={guarRemark}
                  onChange={(e) => setGuarRemark(e.target.value)}
                  placeholder="เงื่อนไขพิเศษ เช่น ค้ำแบบ Joint and Several หรือ Limited"
                />
              </div>
            </div>
          )}
          {tab === 'details' && <DetailsPane cas={cas} />}
          {tab === 'files' && <DocumentTab maId={id} ensureMaId={ensureMaId} /> }
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// Reusable bits
// =====================================================================
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-5 py-3 border-b border-line text-left font-semibold text-sm tracking-wide bg-soft hover:bg-gray-100"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="field-label flex items-center">
        <span className="tracking-wide">{label}</span>
        {required && <span className="text-danger ml-0.5">*</span>}
        <Help label={label} />
      </div>
      {children}
    </div>
  );
}

function Help({ title, label }: { title?: string; label?: string }) {
  // Resolve from TOOLTIPS dictionary by label (case-variants), fallback to title prop.
  const key = (label ?? '').replace(/\s*\*+\s*$/, '').trim();
  const tip = TOOLTIPS[key] ?? TOOLTIPS[key.toUpperCase()] ?? title;
  if (!tip) return null;
  return (
    <span className="relative inline-flex group ml-1">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-[10px] text-gray-600 cursor-help group-hover:bg-brand group-hover:text-white transition">
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 hidden group-hover:block whitespace-normal w-max max-w-xs bg-gray-900 text-white text-xs leading-relaxed px-3 py-2 rounded shadow-lg"
      >
        {tip}
        <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-gray-900 rotate-45 -mt-1"></span>
      </span>
    </span>
  );
}

// =====================================================================
// Tab panes
// =====================================================================
function ConditionPane({
  cond,
  setCond,
}: {
  cond: MACondition;
  setCond: React.Dispatch<React.SetStateAction<MACondition>>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Field label="D/E RATIO">
          <div className="flex items-center gap-2">
            <Select
              className="!w-20"
              value={cond.de_op ?? '<='}
              onChange={(e) => setCond((c) => ({ ...c, de_op: e.target.value as any }))}
            >
              {RATIO_OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <NumInput
              step="0.1"
              value={cond.de_value ?? 0}
              onChange={(v) => setCond((c) => ({ ...c, de_value: v || null }))}
              className="text-right tabular-nums"
            />
            <span className="text-sm text-muted whitespace-nowrap">เท่า</span>
          </div>
        </Field>
        <Field label="DSCR RATIO">
          <div className="flex items-center gap-2">
            <Select
              className="!w-20"
              value={cond.dscr_op ?? '>='}
              onChange={(e) => setCond((c) => ({ ...c, dscr_op: e.target.value as any }))}
            >
              {RATIO_OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <NumInput
              step="0.1"
              value={cond.dscr_value ?? 0}
              onChange={(v) => setCond((c) => ({ ...c, dscr_value: v || null }))}
              className="text-right tabular-nums"
            />
            <span className="text-sm text-muted whitespace-nowrap">เท่า</span>
          </div>
        </Field>
        <Field label="OTHER REQUIREMENT">
          <textarea
            className="input min-h-[110px]"
            value={cond.other_requirement ?? ''}
            onChange={(e) => setCond((c) => ({ ...c, other_requirement: e.target.value }))}
          />
        </Field>
      </div>
      <div>
        <Field label="CONSENT / WAIVER">
          <textarea
            className="input min-h-[200px]"
            value={cond.consent_waiver ?? ''}
            onChange={(e) => setCond((c) => ({ ...c, consent_waiver: e.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}

function DetailsPane({ cas }: { cas: CreditAgreement[] }) {
  if (cas.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <p className="text-sm">ยังไม่มี Credit Agreement ภายใต้ MA นี้</p>
        <p className="text-xs mt-1">
          ไปที่ <a className="text-brand underline" href="/ca">Credit Agreement</a> เพื่อเพิ่ม
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>NAME</th>
            <th>CONTRACT NUMBER</th>
            <th>SUBSIDIARY</th>
            <th>START DATE</th>
            <th>END DATE</th>
            <th className="text-right">CREDIT LINE</th>
            <th className="text-right">UTILIZATION</th>
            <th className="text-right">REMAINING CREDIT LINE</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {cas.map((c) => (
            <tr key={c.id}>
              <td className="text-brand font-medium">{c.ca_name}</td>
              <td>{c.contract_number}</td>
              <td>{c.subsidiary}</td>
              <td>{fmtDate(c.start_date)}</td>
              <td>{fmtDate(c.end_date)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.credit_line)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.utilization)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.remaining)}</td>
              <td>
                <Badge variant={c.status === 'Approved' ? 'success' : 'default'}>{c.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

