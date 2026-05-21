import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select , FieldLabel} from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import {
  type CreditAgreement,
  type CACondition,
  FINANCE_INSTITUTIONS,
  CA_FACILITY_TYPES,
  CA_CREDIT_TYPES,
  CA_SUBSIDIARIES_SHORT,
  CA_STATUS,
  RATIO_OPS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, type RateCard } from '@/components/tx/RateCards';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { CollateralCards, type Collateral, type CollateralType } from '@/components/ma/CollateralCards';
import { GuarantorCards, type Guarantor } from '@/components/ma/GuarantorCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';

type Form = Omit<CreditAgreement, 'id' | 'remaining' | 'created_at' | 'updated_at'> & {
  rate_cards: RateCard[];
  acct_cards: AcctCard[];
};

const blank: Form = {
  ma_id: null,
  ca_name: '',
  contract_number: '',
  subsidiary: 'MCR',
  facility_type: '',
  finance_institution: 'KBANK',
  currency: 'THB',
  credit_line: 0,
  credit_line_foreign: null,
  fx_rate: null,
  fx_rate_date: null,
  credit_type: 'Revolving',
  rollover_max_days: null,
  rollover_max_times: null,
  conversion_date: null,
  conversion_rate: null,
  loan_purpose: null,
  reference_contract: null,
  curtailment_option: false,
  remark: null,
  utilization: 0,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  status: 'Draft',
  rate_cards: [],
  acct_cards: [],
};

export function CADetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [cond, setCond] = useState<CACondition>({
    ca_id: '', de_op: '<=', de_value: null, dscr_op: '>=', dscr_value: null,
    other_requirement: '', consent_waiver: '',
  });
  const [collaterals, setCollaterals] = useState<Collateral[]>([]);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const userLabel = useCurrentUserLabel();
  const readOnly = useReadOnly();

  const { data: maOptions } = useQuery({
    queryKey: ['ma-options-for-ca'],
    queryFn: async () => {
      const { data } = await supabase.from('master_agreements').select('id, ma_name, subsidiary').order('ma_name');
      return (data ?? []) as { id: string; ma_name: string; subsidiary: string }[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['ca', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [main, condR, colR, guarR] = await Promise.all([
        supabase.from('credit_agreements').select('*').eq('id', id!).single(),
        supabase.from('ca_conditions').select('*').eq('ca_id', id!).maybeSingle(),
        supabase.from('ca_collaterals').select('*').eq('ca_id', id!).order('sort_order'),
        supabase.from('ca_guarantors').select('*').eq('ca_id', id!).order('sort_order'),
      ]);
      if (main.error) throw main.error;
      return {
        main: main.data as any,
        cond: condR.data as CACondition | null,
        cols: (colR.data ?? []) as any[],
        guars: (guarR.data ?? []) as any[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, remaining: _r, created_at: _c, updated_at: _u, ...rest } = existing.main;
      setForm({
        ...rest,
        rate_cards: existing.main.rate_cards ?? [],
        acct_cards: existing.main.acct_cards ?? [],
      });
      if (existing.cond) setCond(existing.cond);
      setCollaterals(existing.cols.map((c) => ({ id: c.id, type: c.type as CollateralType, fields: c.fields ?? {} })));
      setGuarantors(existing.guars.map((g) => ({ id: g.id, type: g.type as any, fields: g.fields ?? {} })));
    }
  }, [existing]);

  // Auto-fill subsidiary from selected MA
  useEffect(() => {
    if (form.ma_id && maOptions) {
      const ma = maOptions.find((m) => m.id === form.ma_id);
      if (ma) {
        const short = (CA_SUBSIDIARIES_SHORT as readonly string[]).find((s) => ma.subsidiary.includes(s));
        if (short && short !== form.subsidiary) setForm((f) => ({ ...f, subsidiary: short }));
      }
    }
  }, [form.ma_id, maOptions]);

  // ---------- Inherit from MA (Condition / Collateral / Guarantee / Document) ----------
  const { data: maInherited } = useQuery({
    queryKey: ['ma-inherit', form.ma_id],
    enabled: !!form.ma_id,
    queryFn: async () => {
      const [c, col, g, d] = await Promise.all([
        supabase.from('ma_conditions').select('*').eq('ma_id', form.ma_id!).maybeSingle(),
        supabase.from('ma_collaterals').select('*').eq('ma_id', form.ma_id!).order('sort_order'),
        supabase.from('ma_guarantors').select('*').eq('ma_id', form.ma_id!).order('sort_order'),
        supabase.from('ma_documents').select('*').eq('ma_id', form.ma_id!).order('uploaded_at', { ascending: false }),
      ]);
      return {
        cond: c.data as any,
        cols: (col.data ?? []) as any[],
        guars: (g.data ?? []) as any[],
        docs: (d.data ?? []) as any[],
      };
    },
  });

  // In NEW mode: auto-populate Condition/Collateral/Guarantor from MA when MA changes
  useEffect(() => {
    if (mode !== 'new' || !maInherited) return;
    if (maInherited.cond && !cond.other_requirement && !cond.consent_waiver) {
      setCond((c) => ({
        ...c,
        de_op: maInherited.cond.de_op ?? c.de_op,
        de_value: maInherited.cond.de_value ?? c.de_value,
        dscr_op: maInherited.cond.dscr_op ?? c.dscr_op,
        dscr_value: maInherited.cond.dscr_value ?? c.dscr_value,
        other_requirement: maInherited.cond.other_requirement ?? '',
        consent_waiver: maInherited.cond.consent_waiver ?? '',
      }));
    }
    if (collaterals.length === 0 && maInherited.cols.length > 0) {
      setCollaterals(
        maInherited.cols.map((c: any) => ({
          id: crypto.randomUUID(),
          type: c.type as CollateralType,
          fields: c.fields ?? {},
        })),
      );
    }
    if (guarantors.length === 0 && maInherited.guars.length > 0) {
      setGuarantors(
        maInherited.guars.map((g: any) => ({
          id: crypto.randomUUID(),
          type: g.type as any,
          fields: g.fields ?? {},
        })),
      );
    }
  }, [mode, maInherited]);

  // Auto-compute credit_line in THB when currency != THB
  useEffect(() => {
    if (form.currency !== 'THB' && form.credit_line_foreign && form.fx_rate) {
      const thb = form.credit_line_foreign * form.fx_rate;
      if (Math.abs(thb - form.credit_line) > 0.01) {
        setForm((f) => ({ ...f, credit_line: parseFloat(thb.toFixed(2)) }));
      }
    }
  }, [form.currency, form.credit_line_foreign, form.fx_rate]);

  // Warnings
  const overlimit = form.utilization > form.credit_line + 0.01;
  const remaining = form.credit_line - form.utilization;

  // ensureCaId for document upload before save
  const ensureCaId = async (): Promise<string> => {
    if (id) return id;
    const name = form.ca_name.trim() || `DRAFT-${Date.now()}`;
    const { data, error } = await supabase
      .from('credit_agreements')
      .insert({
        ...form,
        ca_name: name,
        contract_number: form.contract_number || `DRAFT-${Date.now()}`,
        status: 'Draft',
        created_by: userLabel,
        updated_by: userLabel,
      })
      .select()
      .single();
    if (error) throw error;
    setForm((f) => ({ ...f, ca_name: name }));
    navigate(`/ca/${data.id}`, { replace: true });
    toast.success('✓ สร้าง Draft อัตโนมัติ');
    return data.id as string;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.ca_name.trim()) throw new Error('กรอก Credit Agreement Name');
      if (!form.contract_number.trim()) throw new Error('กรอก Contract Number');

      let caId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('credit_agreements').insert({ ...form, created_by: userLabel, updated_by: userLabel }).select().single();
        if (error) throw error;
        caId = data.id;
      } else {
        const { error } = await supabase.from('credit_agreements').update({ ...form, updated_by: userLabel, updated_at: new Date().toISOString() }).eq('id', caId!);
        if (error) throw error;
      }

      // Condition upsert
      const { error: ce } = await supabase.from('ca_conditions').upsert({ ...cond, ca_id: caId! });
      if (ce) throw ce;

      // Collaterals
      await supabase.from('ca_collaterals').delete().eq('ca_id', caId!);
      if (collaterals.length > 0) {
        const { error } = await supabase.from('ca_collaterals').insert(
          collaterals.map((c, i) => ({ ca_id: caId!, type: c.type, fields: c.fields, sort_order: i })),
        );
        if (error) throw error;
      }

      // Guarantors
      await supabase.from('ca_guarantors').delete().eq('ca_id', caId!);
      if (guarantors.length > 0) {
        const { error } = await supabase.from('ca_guarantors').insert(
          guarantors.map((g, i) => ({ ca_id: caId!, type: g.type, fields: g.fields, sort_order: i })),
        );
        if (error) throw error;
      }
      return caId;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['ca-list'] });
      qc.invalidateQueries({ queryKey: ['ca', newId] });
      toast.success(mode === 'new' ? '✓ สร้าง CA แล้ว' : '✓ บันทึกแล้ว');
      if (mode === 'new' && newId) navigate(`/ca/${newId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Details Transaction tab — list HP/Lease/etc under this CA
  const { data: txList } = useQuery({
    queryKey: ['ca-transactions', id],
    enabled: !!id,
    queryFn: async () => {
      // Helper: add months to a date → maturity for term-based facilities (Loan/Lease)
      const addMonths = (iso: string, months: number) => {
        const d = new Date(iso);
        d.setMonth(d.getMonth() + months);
        return d.toISOString().slice(0, 10);
      };

      const [leases, loans, pns, ods, trs, fps, fxfs] = await Promise.all([
        supabase.from('leases').select('id,lease_no,asset_name,start_date,term_months,principal,status').eq('ca_id', id!),
        supabase.from('loans').select('id,loan_no,principal,annual_rate,term_months,start_date,end_date,status').eq('ca_id', id!),
        supabase.from('promissory_notes').select('id,name,pn_number,transaction_date,maturity_date,amount,status').eq('ca_id', id!),
        supabase.from('overdrafts').select('id,od_no,facility_limit,used_amount,start_date,end_date,status').eq('ca_id', id!),
        supabase.from('trust_receipts').select('id,tr_no,supplier,invoice_date,due_date,amount,status').eq('ca_id', id!),
        supabase.from('floor_plans').select('id,fp_no,vendor,start_date,end_date,total_amount,status').eq('ca_id', id!),
        supabase.from('fx_forwards').select('id,fxf_no,ccy_buy,ccy_sell,deal_date,value_date,amount_buy,status').eq('ca_id', id!),
      ]);
      return [
        ...(leases.data ?? []).map((r: any) => ({
          kind: 'Lease', name: r.lease_no, desc: r.asset_name,
          start: r.start_date, maturity: addMonths(r.start_date, r.term_months),
          amount: r.principal, status: r.status, link: `/lease/hp/${r.id}`,
        })),
        ...(loans.data ?? []).map((r: any) => ({
          kind: 'Loan', name: r.loan_no, desc: `${r.annual_rate}%`,
          start: r.start_date, maturity: r.end_date ?? addMonths(r.start_date, r.term_months),
          amount: r.principal, status: r.status, link: `/tx/loan/${r.id}`,
        })),
        ...(pns.data ?? []).map((r: any) => ({
          kind: 'P/N', name: r.name, desc: r.pn_number,
          start: r.transaction_date, maturity: r.maturity_date,
          amount: r.amount, status: r.status, link: `/tx/pn/${r.id}`,
        })),
        ...(ods.data ?? []).map((r: any) => ({
          kind: 'O/D', name: r.od_no, desc: '—',
          start: r.start_date, maturity: r.end_date ?? '—',
          amount: r.facility_limit, status: r.status, link: `/tx/od/${r.id}`,
        })),
        ...(trs.data ?? []).map((r: any) => ({
          kind: 'T/R', name: r.tr_no, desc: r.supplier,
          start: r.invoice_date ?? r.due_date, maturity: r.due_date,
          amount: r.amount, status: r.status, link: `/tx/tr/${r.id}`,
        })),
        ...(fps.data ?? []).map((r: any) => ({
          kind: 'Floor Plan', name: r.fp_no, desc: r.vendor,
          start: r.start_date, maturity: r.end_date ?? '—',
          amount: r.total_amount, status: r.status, link: `/tx/fp/${r.id}`,
        })),
        ...(fxfs.data ?? []).map((r: any) => ({
          kind: 'FX Forward', name: r.fxf_no, desc: `${r.ccy_buy}/${r.ccy_sell}`,
          start: r.deal_date, maturity: r.value_date,
          amount: r.amount_buy, status: r.status, link: `/tx/fxf/${r.id}`,
        })),
      ];
    },
  });

  const tabs: TabDef[] = [
    { key: 'acct', label: 'Accounting', render: () => <AcctCards accounts={form.acct_cards} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} /> },
    { key: 'rate', label: 'Interest Rate', render: () => <RateCards rates={form.rate_cards} onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))} /> },
    {
      key: 'cond', label: 'Condition',
      render: () => (
        <div>
          {form.ma_id && <InheritedBanner />}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <RatioField label="D/E RATIO" op={cond.de_op ?? '<='} value={cond.de_value} onOp={(v) => setCond((c) => ({ ...c, de_op: v }))} onValue={(v) => setCond((c) => ({ ...c, de_value: v }))} />
              <RatioField label="DSCR RATIO" op={cond.dscr_op ?? '>='} value={cond.dscr_value} onOp={(v) => setCond((c) => ({ ...c, dscr_op: v }))} onValue={(v) => setCond((c) => ({ ...c, dscr_value: v }))} />
              <div>
                <FieldLabel>OTHER REQUIREMENT</FieldLabel>
                <textarea className="input min-h-[110px]" value={cond.other_requirement ?? ''} onChange={(e) => setCond((c) => ({ ...c, other_requirement: e.target.value }))} />
              </div>
            </div>
            <div>
              <FieldLabel>CONSENT / WAIVER</FieldLabel>
              <textarea className="input min-h-[200px]" value={cond.consent_waiver ?? ''} onChange={(e) => setCond((c) => ({ ...c, consent_waiver: e.target.value }))} />
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'col', label: 'Collateral',
      render: () => (
        <div>
          {form.ma_id && <InheritedBanner />}
          <CollateralCards items={collaterals} onChange={setCollaterals} />
        </div>
      ),
    },
    {
      key: 'guar', label: 'Guarantee',
      render: () => (
        <div>
          {form.ma_id && <InheritedBanner />}
          <GuarantorCards items={guarantors} onChange={setGuarantors} />
          <p className="text-xs text-muted mt-3 italic">※ นิติบุคคลค้ำประกัน รวมถึง บริษัท, ห้างหุ้นส่วน, มูลนิธิ, สมาคม, สหกรณ์ ฯลฯ</p>
        </div>
      ),
    },
    {
      key: 'tx', label: 'Details Transaction',
      render: () => (
        <div>
          <p className="text-xs text-muted mb-3 italic">📌 รายการธุรกรรมที่เบิกใช้วงเงินภายใต้ CA นี้</p>
          {!txList || txList.length === 0 ? (
            <div className="text-center text-muted py-8">ยังไม่มีธุรกรรมภายใต้ CA นี้</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Reference</th>
                      <th>Start Date</th>
                      <th>Maturity</th>
                      <th className="text-center">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txList.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td><span className="px-2 py-0.5 text-xs bg-brand-light text-brand rounded">{r.kind}</span></td>
                        <td><a href={r.link} className="text-brand font-medium hover:underline">{r.name}</a></td>
                        <td>{r.desc ?? '—'}</td>
                        <td>{r.start ?? '—'}</td>
                        <td>{r.maturity ?? '—'}</td>
                        <td className="text-center tabular-nums">{fmtMoney(r.amount)}</td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'docs', label: 'Document',
      render: () => (
        <div>
          {form.ma_id && maInherited && maInherited.docs.length > 0 && (
            <InheritedDocsList docs={maInherited.docs} maId={form.ma_id} />
          )}
          <div className="text-sm font-semibold mb-3 mt-4">📂 CA Documents</div>
          <DocumentTabGeneric parentId={id} ensureParentId={ensureCaId} bucketName="ca-documents" tableName="ca_documents" parentFkColumn="ca_id" />
        </div>
      ),
    },
  ];

  const isForeign = form.currency !== 'THB';

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/ca')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Credit Agreement</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New Credit Agreement' : form.ca_name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || readOnly} onClick={() => save.mutate()}><Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}</Button>
        <Button onClick={() => navigate('/ca')}>Cancel</Button>
      </div>

      <AuditFooter
        createdBy={(existing as any)?.created_by}
        createdAt={(existing as any)?.created_at}
        updatedBy={(existing as any)?.updated_by}
        updatedAt={(existing as any)?.updated_at}
      />

      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <FieldSelect label="FINANCE INSTITUTION *" value={form.finance_institution ?? 'KBANK'} options={[...FINANCE_INSTITUTIONS]} onChange={(v) => setForm((f) => ({ ...f, finance_institution: v }))} />
            <FieldInput label="CREDIT AGREEMENT NAME *" value={form.ca_name} onChange={(v) => setForm((f) => ({ ...f, ca_name: v }))} placeholder="CA-HP001" />
            <FieldInput label="CONTRACT NUMBER" value={form.contract_number} onChange={(v) => setForm((f) => ({ ...f, contract_number: v }))} placeholder="HP2024-001" />
            <FieldDate label="START DATE *" value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v ?? '' }))} />
            <FieldNum label="ROLL OVER CONDITION MAXIMUM TERM (DAYS)" value={form.rollover_max_days} onChange={(v) => setForm((f) => ({ ...f, rollover_max_days: v }))} />
            <FieldSelect label="CURRENCY *" value={form.currency} options={['THB', 'USD', 'EUR', 'JPY']} onChange={(v) => setForm((f) => ({ ...f, currency: v }))} />
            {isForeign && (
              <>
                <FieldNumDec label="CREDIT LINE (Foreign)" value={form.credit_line_foreign} onChange={(v) => setForm((f) => ({ ...f, credit_line_foreign: v }))} />
                <FieldNumDec label={`FX RATE (THB per 1 ${form.currency}) *`} value={form.fx_rate} onChange={(v) => setForm((f) => ({ ...f, fx_rate: v }))} />
                <FieldDate label="FX RATE DATE *" value={form.fx_rate_date} onChange={(v) => setForm((f) => ({ ...f, fx_rate_date: v }))} />
              </>
            )}
            <FieldNumDec label="CREDIT LINE *" value={form.credit_line} onChange={(v) => setForm((f) => ({ ...f, credit_line: v ?? 0 }))} />
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>MASTER AGREEMENT</FieldLabel>
              <Select value={form.ma_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, ma_id: e.target.value || null }))}>
                <option value="">— เลือก —</option>
                {(maOptions ?? []).map((m) => <option key={m.id} value={m.id}>{m.ma_name}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required>FACILITY TYPE</FieldLabel>
              <Select value={form.facility_type} onChange={(e) => setForm((f) => ({ ...f, facility_type: e.target.value }))}>
                <option value="">— เลือก —</option>
                {CA_FACILITY_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </div>
            <FieldSelect label="CREDIT TYPE *" value={form.credit_type} options={[...CA_CREDIT_TYPES]} onChange={(v) => setForm((f) => ({ ...f, credit_type: v }))} />
            <FieldDate label="END DATE *" value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v ?? '' }))} />
            <FieldNum label="MAXIMUM ROLL OVER (TIMES)" value={form.rollover_max_times} onChange={(v) => setForm((f) => ({ ...f, rollover_max_times: v }))} />
            <FieldDate label="CONVERSION DATE" value={form.conversion_date} onChange={(v) => setForm((f) => ({ ...f, conversion_date: v }))} />
            <FieldInput label="REMARK" value={form.remark ?? ''} onChange={(v) => setForm((f) => ({ ...f, remark: v || null }))} />
            <div>
              <FieldLabel>UTILIZATION</FieldLabel>
              <Input readOnly value={fmtMoney(form.utilization)} className="bg-gray-50 text-right tabular-nums" title="คำนวณจากธุรกรรมภายใต้ CA นี้" />
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <FieldSelect label="SUBSIDIARY *" value={form.subsidiary} options={[...CA_SUBSIDIARIES_SHORT]} onChange={(v) => setForm((f) => ({ ...f, subsidiary: v }))} />
            <FieldSelect label="AGREEMENT STATUS *" value={form.status} options={[...CA_STATUS]} onChange={(v) => setForm((f) => ({ ...f, status: v as any }))} />
            <FieldInput label="LOAN PURPOSE" value={form.loan_purpose ?? ''} onChange={(v) => setForm((f) => ({ ...f, loan_purpose: v || null }))} placeholder="Hire Purchase Financing…" />
            <FieldInput label="REFERENCE CONTRACT" value={form.reference_contract ?? ''} onChange={(v) => setForm((f) => ({ ...f, reference_contract: v || null }))} />
            <div className="flex items-center gap-2 pt-3">
              <input
                id="curtail"
                type="checkbox"
                checked={form.curtailment_option}
                onChange={(e) => setForm((f) => ({ ...f, curtailment_option: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="curtail" className="text-sm font-semibold tracking-wide">
                CURTAILMENT OPTION
              </label>
            </div>
            <FieldNumDec label="CONVERSION RATE" value={form.conversion_rate} onChange={(v) => setForm((f) => ({ ...f, conversion_rate: v }))} />
            <div>
              <FieldLabel>REMAINING CREDIT LINE</FieldLabel>
              <Input readOnly value={fmtMoney(remaining)} className="bg-gray-50 text-right tabular-nums" />
            </div>
          </div>
        </div>

        {overlimit && (
          <div className="mt-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-800 text-sm rounded">
            ⚠️ <strong>เกินวงเงิน:</strong> Utilization ({fmtMoney(form.utilization)}) สูงกว่า Credit Line ({fmtMoney(form.credit_line)})
          </div>
        )}
      </Section>

      <Tabs tabs={tabs} defaultTab="acct" />
    </div>
  );
}

// =====================================================================
//  Small field components — all use <FieldLabel> for tooltip support
// =====================================================================
function splitLabel(label: string): { clean: string; required: boolean } {
  const required = /\s*\*+\s*$/.test(label);
  const clean = label.replace(/\s*\*+\s*$/, '').trim();
  return { clean, required };
}

function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { clean, required } = splitLabel(label);
  return (
    <div>
      <FieldLabel required={required}>{clean}</FieldLabel>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const { clean, required } = splitLabel(label);
  return (
    <div>
      <FieldLabel required={required}>{clean}</FieldLabel>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </div>
  );
}

function FieldDate({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const { clean, required } = splitLabel(label);
  return (
    <div>
      <FieldLabel required={required}>{clean}</FieldLabel>
      <Input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    </div>
  );
}

function FieldNum({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const { clean, required } = splitLabel(label);
  return (
    <div>
      <FieldLabel required={required}>{clean}</FieldLabel>
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}
        className="text-right tabular-nums"
      />
    </div>
  );
}

function FieldNumDec({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const { clean, required } = splitLabel(label);
  return (
    <div>
      <FieldLabel required={required}>{clean}</FieldLabel>
      <Input
        type="number"
        step="0.0001"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
        className="text-right tabular-nums"
      />
    </div>
  );
}

function InheritedBanner() {
  return (
    <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded text-xs mb-4 flex items-start gap-2">
      <span>🔗</span>
      <span>
        <strong>ดึงจาก Master Agreement</strong> — แก้ไขที่นี่จะ override เฉพาะ CA นี้ (ไม่กระทบ MA)
      </span>
    </div>
  );
}

function InheritedDocsList({ docs, maId }: { docs: any[]; maId: string }) {
  const onView = (doc: any) => {
    if (!doc.storage_path) return;
    const { data } = supabase.storage.from('ma-documents').getPublicUrl(doc.storage_path);
    window.open(data.publicUrl, '_blank');
  };
  const onDownload = async (doc: any) => {
    if (!doc.storage_path) return;
    const { data, error } = await supabase.storage.from('ma-documents').download(doc.storage_path);
    if (error) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = doc.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };
  function fmtBytes(n: number | null): string {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  return (
    <div>
      <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded text-xs mb-3 flex items-start gap-2">
        <span>🔗</span>
        <span><strong>เอกสารดึงจาก Master Agreement</strong> — แสดงเป็น read-only · upload ที่ MA ถ้าต้องการแก้</span>
      </div>
      <div className="text-sm font-semibold mb-2">📎 Inherited from MA ({docs.length})</div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-28">Action</th>
              <th>File Name</th>
              <th className="text-right">Size</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => onView(d)} className="text-brand hover:underline">View</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => onDownload(d)} className="text-brand hover:underline">Download</button>
                  </div>
                </td>
                <td>{d.file_type?.startsWith('image/') ? '🖼' : '📕'} {d.file_name}</td>
                <td className="text-right tabular-nums">{fmtBytes(d.size_bytes)}</td>
                <td>{new Date(d.uploaded_at).toLocaleDateString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RatioField({ label, op, value, onOp, onValue }: { label: string; op: string; value: number | null; onOp: (v: string) => void; onValue: (v: number | null) => void }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Select className="!w-20" value={op} onChange={(e) => onOp(e.target.value)}>
          {RATIO_OPS.map((o) => <option key={o}>{o}</option>)}
        </Select>
        <Input
          type="number"
          step="0.1"
          value={value ?? ''}
          onChange={(e) => onValue(e.target.value ? parseFloat(e.target.value) : null)}
          className="text-right tabular-nums"
        />
        <span className="text-sm text-muted whitespace-nowrap">เท่า</span>
      </div>
    </div>
  );
}
