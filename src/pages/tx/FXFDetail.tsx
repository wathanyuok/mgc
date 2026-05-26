import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { Button, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type FXForward,
  type FXFFee,
  type FXFFairValue,
  type FXFStatus,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { createJE, postJE } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';

const FXF_STATUSES: FXFStatus[] = ['Draft', 'Approved', 'Active', 'Settled', 'Closed', 'Cancelled'];
const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];

type Form = Omit<FXForward, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  fxf_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  deal_date: new Date().toISOString().slice(0, 10),
  value_date: new Date().toISOString().slice(0, 10),
  transaction_date: new Date().toISOString().slice(0, 10),
  maturity_date: null,
  term_days: 180,
  direction: 'Buy',
  ccy_buy: 'USD',
  ccy_sell: 'THB',
  currency: 'USD',
  amount_buy: 0,
  amount_sell: 0,
  notional_amount_foreign: null,
  amount_thb: null,
  conversion_date: null,
  spot_rate: null,
  forward_rate: 0,
  swap_points: null,
  reference_transaction: null,
  reference_tr_contract: null,
  inactive: false,
  status: 'Draft',
  remark: null,
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Approved: 'success',
  Active: 'success',
  Settled: 'default',
  Closed: 'default',
  Cancelled: 'danger',
};

export function FXFDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);

  const { data: existing } = useQuery({
    queryKey: ['fxf', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('fx_forwards').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as FXForward;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm({ ...rest, acct_cards: existing.acct_cards ?? [] });
    }
  }, [existing]);

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-fxf'],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .order('ca_name');
      return data ?? [];
    },
  });

  // Auto-compute maturity = transaction + term_days
  useEffect(() => {
    if (form.transaction_date && form.term_days) {
      const d = new Date(form.transaction_date);
      d.setDate(d.getDate() + form.term_days);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== form.maturity_date) setForm((f) => ({ ...f, maturity_date: iso, value_date: iso }));
    }
  }, [form.transaction_date, form.term_days]);

  // Auto-compute amount_thb = notional × forward_rate
  useEffect(() => {
    if (form.notional_amount_foreign != null && form.forward_rate) {
      const calc = form.notional_amount_foreign * form.forward_rate;
      if (Math.abs(calc - (form.amount_thb ?? 0)) > 0.01) {
        setForm((f) => ({ ...f, amount_thb: parseFloat(calc.toFixed(2)) }));
      }
    }
  }, [form.notional_amount_foreign, form.forward_rate]);

  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  // Save
  const save = useMutation({
    mutationFn: async () => {
      let fxfId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('fx_forwards').insert({ ...form, created_by: userLabel, updated_by: userLabel }).select().single();
        if (error) throw error;
        fxfId = data.id;
      } else {
        const { error } = await supabase.from('fx_forwards').update({ ...form, updated_by: userLabel, updated_at: new Date().toISOString() }).eq('id', fxfId!);
        if (error) throw error;
      }
      return fxfId;
    },
    onSuccess: (fxfId: any) => {
      qc.invalidateQueries({ queryKey: ['fxf-list'] });
      qc.invalidateQueries({ queryKey: ['fxf', fxfId] });
      toast.success(mode === 'new' ? 'สร้าง FX Forward แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && fxfId) navigate(`/tx/fxf/${fxfId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Settlement JE (Maturity — Amount THB → GL) ──
  const settleContract = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save FX Forward ก่อน');
      if (form.status !== 'Active') {
        throw new Error(`Settle ได้เฉพาะ Status = Active — ตอนนี้: "${form.status}"`);
      }
      const notional = form.notional_amount_foreign ?? 0;
      const amountTHB = form.amount_thb ?? (notional * (form.forward_rate ?? 0));
      if (notional <= 0 || amountTHB <= 0) throw new Error('Notional + Forward Rate ต้อง > 0');

      // Race-safe — block if already settled
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'FXF_SETTLEMENT')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`Settlement JE มีอยู่แล้ว: ${existing[0].je_number}`);
      }

      // Reverse outstanding Fair Value JEs (mark-to-market needs to be unwound at settlement)
      const { data: fairJEs } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('source_type', 'FXF_FAIRVALUE')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      const { reverseJE } = await import('@/lib/je');
      for (const je of fairJEs ?? []) {
        await reverseJE(je.id, 'user');
      }

      // Settlement JE — receive USD, pay THB at locked forward rate
      const je = await createJE({
        source_type: 'FXF_SETTLEMENT',
        source_id: id,
        je_date: form.maturity_date ?? new Date().toISOString().slice(0, 10),
        description: `${form.name ?? form.fxf_no} — FX Forward Settlement`,
        remark: `${notional.toLocaleString()} ${form.currency} × ${form.forward_rate?.toFixed(4)} = ${amountTHB.toLocaleString()} THB`,
        lines: [
          {
            account_code: '100001',
            account_name: `Bank — ${form.currency}`,
            dr: amountTHB,
            description: `Receive ${notional.toLocaleString()} ${form.currency}`,
          },
          {
            account_code: '100000',
            account_name: 'Cheque Account (THB)',
            cr: amountTHB,
            description: `Pay THB at locked forward rate ${form.forward_rate?.toFixed(4)}`,
          },
        ],
      });
      await postJE(je.id, 'user');

      // Update status → Settled
      await supabase.from('fx_forwards').update({ status: 'Settled' }).eq('id', id);
      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fxf-je', id] });
      qc.invalidateQueries({ queryKey: ['fxf', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Settled' }));
      toast.success('✓ Settled · Fair Value reversed · Status → Settled');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ensureFxfId = async (): Promise<string> => {
    if (id) return id;
    const fxfNo = (form.fxf_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || (id ? fxfNo : await nextRunningNo(RUNNING_PREFIX.fxf));
    const { data, error } = await supabase
      .from('fx_forwards')
      .insert({ ...form, fxf_no: fxfNo, name, status: 'Draft' })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['fxf-list'] });
    navigate(`/tx/fxf/${data.id}`, { replace: true });
    return data.id as string;
  };

  // =========== Tabs ===========
  const tabs: TabDef[] = [
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards
          accounts={form.acct_cards as AcctCard[]}
          onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))}
        />
      ),
    },
    {
      key: 'fee',
      label: 'Fee Payment',
      render: () => <FeePaymentTab fxfId={id} fxfName={form.name ?? form.fxf_no} fxfStatus={form.status} />,
    },
    {
      key: 'fair',
      label: 'Fair Value',
      render: () => <FairValueTab fxfId={id} fxfName={form.name ?? form.fxf_no} fxfStatus={form.status} />,
    },
    {
      key: 'docs',
      label: 'Document',
      render: () => (
        <div className="space-y-6">
          <InheritedDocs caId={form.ca_id} />
          <div>
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              Transaction Documents
              <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">
                FX Forward
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureFxfId}
              bucketName="fxf-documents"
              tableName="fxf_documents"
              parentFkColumn="fxf_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/fxf')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            FX Forward
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New FX Forward' : (form.name ?? form.fxf_no)}
          </p>
        </div>
        <Button
          onClick={() => settleContract.mutate()}
          disabled={!id || settleContract.isPending || form.status !== 'Active' || !can('fxf', 'approve')}
          title={
            !id
              ? 'Save ก่อน'
              : form.status !== 'Active'
                ? `Settle ได้เฉพาะ Status = Active — ตอนนี้: "${form.status}"`
                : `Settle Contract · Post Amount THB ${fmtMoney(form.amount_thb ?? 0)} → GL`
          }
          className="bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
        >
          💱 {settleContract.isPending ? 'Settling...' : 'Settle Contract'}
        </Button>
        <Button variant="primary" disabled={save.isPending || !can('fxf', 'edit')} title={!can('fxf', 'edit') ? 'ไม่มีสิทธิ์แก้ไข FX Forward' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/fxf')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {FINANCE_INSTITUTIONS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.inactive}
                onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.checked }))}
              />
              <FieldLabel>INACTIVE</FieldLabel>
            </label>
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={async (e) => { const caId = e.target.value || null; setForm((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}
              >
                <option value="">— เลือก CA —</option>
                {caOptions?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.ca_name}{c.contract_number ? ` · ${c.contract_number}` : ''}
                  </option>
                ))}
              </Select>
              {selectedCa && (
                <p className="text-xs text-muted mt-1">
                  → <a className="text-brand hover:underline" href={`/ca/${selectedCa.id}`}>{(selectedCa as any).ca_name}</a>
                </p>
              )}
            </div>
            <div>
              <FieldLabel tipKey="FXF NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel tipKey="BANK REFERENCE">TRANSACTION NUMBER</FieldLabel>
              <Input
                value={form.fxf_no}
                onChange={(e) => setForm((f) => ({ ...f, fxf_no: e.target.value }))}
                placeholder="FWC0001"
              />
            </div>
            <div>
              <FieldLabel required tipKey="TRANSACTION DATE">TRANSACTION DATE</FieldLabel>
              <Input
                type="date"
                value={form.transaction_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel required tipKey="TERM (DAYS)">TERM (DAYS)</FieldLabel>
              <NumInput value={form.term_days ?? 0} onChange={(v) => setForm((f) => ({ ...f, term_days: v }))} />
            </div>
            <div>
              <FieldLabel tipKey="MATURITY DATE">MATURITY DATE</FieldLabel>
              <Input
                type="date"
                value={form.maturity_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, maturity_date: e.target.value || null }))}
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Transaction Date + Term (Days)</p>
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="FX Forward" className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel>CURRENCY</FieldLabel>
              <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required>NOTIONAL AMOUNT (FOREIGN)</FieldLabel>
              <NumInput
                value={form.notional_amount_foreign ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, notional_amount_foreign: v }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="CONVERSION DATE">CONVERSION DATE</FieldLabel>
              <Input
                type="date"
                value={form.conversion_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, conversion_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel required>FORWARD RATE</FieldLabel>
              <NumInput
                value={form.forward_rate ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, forward_rate: v }))}
                placeholder="35.0000"
              />
            </div>
            <div>
              <FieldLabel>AMOUNT (THB)</FieldLabel>
              <NumInput
                value={form.amount_thb ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, amount_thb: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Notional × Forward Rate</p>
            </div>
            <div>
              <FieldLabel tipKey="SPOT RATE">SPOT RATE</FieldLabel>
              <NumInput
                value={form.spot_rate ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, spot_rate: v }))}
                placeholder="36.0000"
              />
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FXFStatus }))}>
                {FXF_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea
                className="input min-h-[60px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุ"
              />
            </div>
            <div>
              <FieldLabel>REFERENCE TRANSACTION</FieldLabel>
              <Input
                value={form.reference_transaction ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, reference_transaction: e.target.value || null }))}
                placeholder="INV2024100005"
              />
            </div>
            <div>
              <FieldLabel>REFERENCE T/R CONTRACT</FieldLabel>
              <Input
                value={form.reference_tr_contract ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, reference_tr_contract: e.target.value || null }))}
                placeholder=""
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── Contract Summary Card (Key calculated outputs) ── */}
      <ContractSummaryCard form={form} />

      {/* Section title (ตาม HTML) */}
      <div className="text-sm font-bold text-ink mt-5 mb-2 pl-1">บันทึก Credit Transaction</div>

      <div>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
}

// ============== Contract Summary Card ==============
function ContractSummaryCard({ form }: { form: Form }) {
  const notional = form.notional_amount_foreign ?? 0;
  const forward = form.forward_rate ?? 0;
  const spot = form.spot_rate ?? 0;

  const amountTHB = form.amount_thb ?? notional * forward;
  const spotValue = notional * spot;
  const rateDiff = spot - forward; // positive = spot higher than forward
  const initialFairValue = notional * rateDiff; // Buyer's perspective: positive = locked at cheaper rate (gain)
  const isGain = initialFairValue > 0;
  const isLoss = initialFairValue < 0;

  // Days remaining
  let daysToMaturity = 0;
  let isMatured = false;
  if (form.maturity_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mat = new Date(form.maturity_date);
    daysToMaturity = Math.round((mat.getTime() - today.getTime()) / 86400000);
    isMatured = daysToMaturity < 0;
  }

  const hasData = notional > 0 && forward > 0;

  return (
    <div className="mt-4 bg-gradient-to-r from-blue-50 via-white to-amber-50 border border-line rounded-lg overflow-hidden">
      <div className="bg-brand text-white px-4 py-2 text-sm font-bold flex items-center gap-2">
        Contract Summary
      </div>

      {!hasData ? (
        <div className="p-6 text-center text-muted text-sm italic">
          กรอก <strong>Notional Amount (Foreign)</strong> + <strong>Forward Rate</strong> ใน Primary Info เพื่อแสดงสรุป
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Block 1 — Settlement Amount */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              💰 ยอดที่ต้องเตรียม ณ Maturity
            </div>
            <div className="text-2xl font-bold text-brand tabular-nums">
              {fmtMoney(amountTHB)}
            </div>
            <div className="text-xs text-muted">THB</div>
            <div className="text-[10px] text-muted mt-1.5 italic">
              = {fmtMoney(notional)} {form.currency} × {forward.toFixed(4)}
            </div>
          </div>

          {/* Block 2 — Settle Date */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              📅 วันที่ Settle
            </div>
            <div className={`text-2xl font-bold tabular-nums ${isMatured ? 'text-danger' : 'text-ink'}`}>
              {form.maturity_date ? fmtDate(form.maturity_date) : '—'}
            </div>
            <div className="text-xs text-muted">{form.term_days ?? 0} วัน · {form.currency}</div>
            <div className="text-[10px] text-muted mt-1.5 italic">
              {isMatured ? (
                <span className="text-danger font-semibold">⚠ Past due {Math.abs(daysToMaturity)} วัน</span>
              ) : daysToMaturity === 0 ? (
                <span className="text-amber-700 font-semibold">⚡ Settle วันนี้</span>
              ) : (
                <>เหลือ <strong>{daysToMaturity}</strong> วัน จนถึง Maturity</>
              )}
            </div>
          </div>

          {/* Block 3 — Rate Comparison & Initial Fair Value */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              📈 Initial Fair Value (Day 1)
            </div>
            {spot > 0 ? (
              <>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    isGain ? 'text-emerald-700' : isLoss ? 'text-danger' : 'text-ink'
                  }`}
                >
                  {isGain ? '+' : ''}{fmtMoney(initialFairValue)}
                </div>
                <div className="text-xs text-muted">THB · {isGain ? 'Unrealized Gain' : isLoss ? 'Unrealized Loss' : 'Break-even'}</div>
                <div className="text-[10px] text-muted mt-1.5">
                  Forward: <strong>{forward.toFixed(4)}</strong> ·{' '}
                  Spot: <strong>{spot.toFixed(4)}</strong> ·{' '}
                  Diff:{' '}
                  <strong className={rateDiff > 0 ? 'text-emerald-700' : rateDiff < 0 ? 'text-danger' : ''}>
                    {rateDiff > 0 ? '+' : ''}{rateDiff.toFixed(4)}
                  </strong>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-muted italic mt-2">
                  กรอก <strong>Spot Rate</strong> เพื่อเทียบ
                </div>
                <div className="text-[10px] text-muted mt-1.5">
                  เพื่อคำนวณ Unrealized Gain/Loss ณ Day 1
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ============== Fee Payment Tab ==============
function FeePaymentTab({ fxfId, fxfName, fxfStatus }: { fxfId: string | undefined; fxfName: string; fxfStatus: string }) {
  const qc = useQueryClient();
  const [glDate, setGlDate] = useState(new Date().toISOString().slice(0, 10));
  const [spotFee, setSpotFee] = useState(0);
  const [cancelFee, setCancelFee] = useState(0);

  const { data: fees = [] } = useQuery({
    queryKey: ['fxf-fees', fxfId],
    enabled: !!fxfId,
    queryFn: async () => {
      const { data } = await supabase
        .from('fxf_fees')
        .select('*')
        .eq('fxf_id', fxfId!)
        .order('created_at', { ascending: false });
      return (data ?? []) as FXFFee[];
    },
  });

  const totalFee = spotFee + cancelFee;

  const postFeeJE = useMutation({
    mutationFn: async () => {
      if (!fxfId) throw new Error('Save FX Forward ก่อน');
      if (fxfStatus !== 'Approved' && fxfStatus !== 'Active') {
        throw new Error(`Post JE ได้เฉพาะ Status = Approved/Active — ตอนนี้: "${fxfStatus}"`);
      }
      if (totalFee <= 0) throw new Error('กรอก Spot Fee หรือ Cancellation Fee ก่อน');

      const je = await createJE({
        source_type: 'FXF_FEE',
        source_id: fxfId,
        je_date: glDate,
        description: `${fxfName} — FX Forward Fee`,
        remark: `Spot fee: ${fmtMoney(spotFee)} · Cancellation/Amendment: ${fmtMoney(cancelFee)}`,
        lines: [
          {
            account_code: '5511101',
            account_name: 'Fee – Forward Contract',
            dr: totalFee,
            description: 'FX Forward fee expense',
          },
          {
            account_code: '100000',
            account_name: 'Cheque Account',
            cr: totalFee,
            description: 'Cash leg',
          },
        ],
      });
      await postJE(je.id, 'user');

      // Insert fee record
      await supabase.from('fxf_fees').insert({
        fxf_id: fxfId,
        gl_date: glDate,
        spot_fee: spotFee,
        cancellation_amendment_fee: cancelFee,
        je_id: je.id,
      });

      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fxf-fees', fxfId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ Posted Fee JE');
      setSpotFee(0);
      setCancelFee(0);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <p className="text-sm text-muted mb-4 italic">
        บันทึกค่าธรรมเนียมจากการใช้ Forward Rate ไม่ครบตามสัญญา หรือ Spot Rate กรณีพิเศษ
      </p>
      <div className="flex gap-8 flex-wrap mb-6">
        {/* LEFT */}
        <div className="flex-1 min-w-[240px] space-y-3">
          <div>
            <FieldLabel>GL DATE</FieldLabel>
            <Input type="date" value={glDate} onChange={(e) => setGlDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel tipKey="SPOT FEE">SPOT FEE</FieldLabel>
            <NumInput value={spotFee} onChange={setSpotFee} placeholder="0.00" />
          </div>
        </div>

        {/* CENTER */}
        <div className="flex-1 min-w-[240px] space-y-3">
          <div>
            <FieldLabel tipKey="CANCELLATION OR AMENDMENT FEE">CANCELLATION OR AMENDMENT FEE</FieldLabel>
            <NumInput value={cancelFee} onChange={setCancelFee} placeholder="0.00" />
          </div>
        </div>

        {/* RIGHT: JE Preview + Post */}
        <div className="flex-[1.2] min-w-[340px]">
          <div className="text-right mb-3">
            <Button
              onClick={() => postFeeJE.mutate()}
              disabled={!fxfId || postFeeJE.isPending || totalFee <= 0 || (fxfStatus !== 'Approved' && fxfStatus !== 'Active')}
              title={
                !fxfId
                  ? 'Save ก่อน'
                  : fxfStatus !== 'Approved' && fxfStatus !== 'Active'
                    ? `ต้อง Status = Approved/Active — ตอนนี้: "${fxfStatus}"`
                    : totalFee <= 0
                      ? 'กรอก Fee ก่อน'
                      : 'Post Fee JE'
              }
              className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
            >
              📋 {postFeeJE.isPending ? 'Posting...' : 'Create Journal Entry'}
            </Button>
          </div>

          {totalFee > 0 && (
            <div className="border border-line rounded overflow-hidden">
              <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                <span>JV – Fee</span>
                <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
              </div>
              <table className="table-base text-xs m-0">
                <tbody>
                  <tr>
                    <td>Dr. Fee – Forward Contract</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td>Cr. Bank</td>
                    <td />
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Posted Fee history */}
      {fees.length > 0 && (
        <div>
          <div className="text-sm font-bold mb-2">📋 Fee Payment History</div>
          <table className="table-base">
            <thead>
              <tr>
                <ThTip>GL Date</ThTip>
                <ThTip align="right">Spot Fee</ThTip>
                <ThTip align="right">Cancel/Amend Fee</ThTip>
                <ThTip align="right">Total</ThTip>
                <ThTip>JE</ThTip>
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id}>
                  <td>{fmtDate(f.gl_date)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.spot_fee)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.cancellation_amendment_fee)}</td>
                  <td className="text-right tabular-nums font-semibold">
                    {fmtMoney(f.spot_fee + f.cancellation_amendment_fee)}
                  </td>
                  <td>
                    {f.je_id ? (
                      <a className="text-brand hover:underline text-xs" href={`/je/${f.je_id}`}>
                        View JE →
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============== Fair Value Tab ==============
function FairValueTab({ fxfId, fxfName, fxfStatus }: { fxfId: string | undefined; fxfName: string; fxfStatus: string }) {
  const qc = useQueryClient();
  const [sub, setSub] = useState<'fair' | 'summary'>('fair');
  const [accountingPeriod, setAccountingPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [fairValue, setFairValue] = useState(0);
  const [unrealized, setUnrealized] = useState(0);

  const { data: fairs = [] } = useQuery({
    queryKey: ['fxf-fairs', fxfId],
    enabled: !!fxfId,
    queryFn: async () => {
      const { data } = await supabase
        .from('fxf_fair_values')
        .select('*')
        .eq('fxf_id', fxfId!)
        .order('accounting_period', { ascending: false });
      return (data ?? []) as FXFFairValue[];
    },
  });

  const postFairJE = useMutation({
    mutationFn: async () => {
      if (!fxfId) throw new Error('Save FX Forward ก่อน');
      if (fxfStatus !== 'Approved' && fxfStatus !== 'Active') {
        throw new Error(`Post JE ได้เฉพาะ Status = Approved/Active — ตอนนี้: "${fxfStatus}"`);
      }
      if (unrealized === 0) throw new Error('กรอก Unrealized Gain/Loss ก่อน');

      const isGain = unrealized > 0;
      const amount = Math.abs(unrealized);

      const je = await createJE({
        source_type: 'FXF_FAIRVALUE',
        source_id: fxfId,
        je_date: accountingPeriod,
        description: `${fxfName} — Fair Value @ ${fmtDate(accountingPeriod)}`,
        remark: `Fair value: ${fmtMoney(fairValue)} · Unrealized: ${isGain ? '+' : '-'}${fmtMoney(amount)}`,
        lines: isGain
          ? [
              {
                account_code: '2195100',
                account_name: 'Forward Contract',
                dr: amount,
                description: 'Mark-to-market gain',
              },
              {
                account_code: '7100022',
                account_name: 'Unrealized Gain/Loss',
                cr: amount,
                description: 'Unrealized gain',
              },
            ]
          : [
              {
                account_code: '7100022',
                account_name: 'Unrealized Gain/Loss',
                dr: amount,
                description: 'Unrealized loss',
              },
              {
                account_code: '2195100',
                account_name: 'Forward Contract',
                cr: amount,
                description: 'Mark-to-market loss',
              },
            ],
      });
      await postJE(je.id, 'user');

      await supabase.from('fxf_fair_values').insert({
        fxf_id: fxfId,
        accounting_period: accountingPeriod,
        fair_value: fairValue,
        unrealized_gain_loss: unrealized,
        je_id: je.id,
      });

      // First MTM activity = contract is live → promote Approved → Active.
      let activated = false;
      if (fxfStatus === 'Approved') {
        await supabase.from('fx_forwards').update({ status: 'Active' }).eq('id', fxfId);
        activated = true;
      }
      return { je, activated };
    },
    onSuccess: ({ activated }) => {
      qc.invalidateQueries({ queryKey: ['fxf-fairs', fxfId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      if (activated) {
        qc.invalidateQueries({ queryKey: ['fxf', fxfId] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }
      toast.success(activated ? '✓ Posted Fair Value JE · Status → Active' : '✓ Posted Fair Value JE');
      setFairValue(0);
      setUnrealized(0);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-5 mb-4 pb-1.5 border-b border-line">
        {([
          { key: 'fair', label: 'Fair Value' },
          { key: 'summary', label: 'Summary' },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className={`text-sm font-semibold pb-1 -mb-[7px] border-b-2 transition ${
              sub === t.key ? 'border-brand text-ink' : 'border-transparent text-brand hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'fair' ? (
        <div className="flex gap-8 flex-wrap">
          {/* LEFT */}
          <div className="flex-1 min-w-[300px]">
            <div className="space-y-3 max-w-sm">
              <div>
                <FieldLabel>ACCOUNTING PERIOD</FieldLabel>
                <Input
                  type="date"
                  value={accountingPeriod}
                  onChange={(e) => setAccountingPeriod(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>FAIR VALUE</FieldLabel>
                <NumInput value={fairValue} onChange={setFairValue} placeholder="32,000,000.00" />
              </div>
              <div>
                <FieldLabel>UNREALIZED GAIN/LOSS</FieldLabel>
                <NumInput value={unrealized} onChange={setUnrealized} allowNegative placeholder="3,000,000.00 (negative = loss)" />
                <p className="text-[10px] text-muted mt-0.5">บวก = Gain · ลบ = Loss</p>
              </div>
            </div>
          </div>

          {/* CENTER: Post button */}
          <div className="flex items-start min-w-[200px]">
            <Button
              onClick={() => postFairJE.mutate()}
              disabled={!fxfId || postFairJE.isPending || unrealized === 0 || (fxfStatus !== 'Approved' && fxfStatus !== 'Active')}
              title={
                !fxfId
                  ? 'Save ก่อน'
                  : fxfStatus !== 'Approved' && fxfStatus !== 'Active'
                    ? `ต้อง Status = Approved/Active — ตอนนี้: "${fxfStatus}"`
                    : unrealized === 0
                      ? 'กรอก Unrealized Gain/Loss ก่อน'
                      : 'Post Fair Value JE (auto-reverse next month)'
              }
              className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
            >
              📋 {postFairJE.isPending ? 'Posting...' : 'Create Journal Entry'}
            </Button>
          </div>

          {/* RIGHT: JV Preview */}
          <div className="flex-[1.2] min-w-[340px]">
            {unrealized !== 0 && (
              <>
                <div className="border border-line rounded overflow-hidden">
                  <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                    <span>JV – Fair Value</span>
                    <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                  </div>
                  <table className="table-base text-xs m-0">
                    <tbody>
                      {unrealized > 0 ? (
                        <>
                          <tr>
                            <td>Dr. Forward Contract</td>
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                            <td />
                          </tr>
                          <tr>
                            <td>Cr. Unrealized Gain/Loss</td>
                            <td />
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td>Dr. Unrealized Gain/Loss</td>
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                            <td />
                          </tr>
                          <tr>
                            <td>Cr. Forward Contract</td>
                            <td />
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted italic mt-1.5">** Auto Reverse ต้นเดือนถัดไป</p>
              </>
            )}
          </div>
        </div>
      ) : (
        // Summary sub-tab
        <div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <ThTip>Accounting Period</ThTip>
                  <ThTip align="right">Fair Value</ThTip>
                  <ThTip align="right">Unrealized Gain/Loss</ThTip>
                  <ThTip>Journal Entry</ThTip>
                </tr>
              </thead>
              <tbody>
                {fairs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-muted py-8 italic">
                      ยังไม่มีรายการ Fair Value — กลับไป Fair Value sub-tab เพื่อ post
                    </td>
                  </tr>
                ) : (
                  fairs.map((fv) => (
                    <tr key={fv.id}>
                      <td>{fmtDate(fv.accounting_period)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(fv.fair_value)}</td>
                      <td className={`text-right tabular-nums ${fv.unrealized_gain_loss < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                        {fv.unrealized_gain_loss > 0 ? '+' : ''}
                        {fmtMoney(fv.unrealized_gain_loss)}
                      </td>
                      <td>
                        {fv.je_id ? (
                          <a className="text-brand hover:underline text-xs" href={`/je/${fv.je_id}`}>
                            View JE →
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {fairs.length > 0 && (
            <div className="mt-3 max-w-md space-y-1 text-sm">
              <RowTip
                label="Latest Fair Value"
                value={fmtMoney(fairs[0]?.fair_value ?? 0)}
                bold
              />
              <RowTip
                label="Latest Unrealized Gain/Loss"
                value={
                  <span className={fairs[0]?.unrealized_gain_loss < 0 ? 'text-danger font-bold' : 'text-emerald-700 font-bold'}>
                    {(fairs[0]?.unrealized_gain_loss ?? 0) > 0 ? '+' : ''}
                    {fmtMoney(fairs[0]?.unrealized_gain_loss ?? 0)}
                  </span>
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
