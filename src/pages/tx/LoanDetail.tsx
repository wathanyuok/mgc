import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, FileText, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, NumInput, Modal } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { buildSchedule, pmt } from '@/lib/lease-calc';
import {
  type Loan,
  type LoanChassis,
  type LoanStatus,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';

const LOAN_STATUSES: LoanStatus[] = ['Draft', 'Approved', 'Active', 'Closed', 'Modified', 'Rejected', 'Cancelled'];
const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];
const PAYMENT_TYPES = [
  'Fix Installment / Fix Installment & Step payment',
  'Fix Installment (Balloon) / Fix Installment & Step payment (Balloon)',
  'Fix Principal / Fix Principal & Step payment',
  'Fix Principal (Balloon) / Fix Principal & Step payment (Balloon)',
  'Grace Period and Fix Installment',
  'Grace Period and Fix Principal',
];
const BALLOON_OPTIONS = ['พร้อมค่างวด (รวมในงวดสุดท้าย)', 'หลัง Term (เป็นงวด N+1)', 'ก่อน Term (ลดงวดเหลือ N-1)'];

type Form = Omit<Loan, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  loan_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  principal: 0,
  amount: 0,
  amount_foreign: null,
  conversion_date: null,
  conversion_rate: null,
  currency: 'THB',
  annual_rate: 5.5,
  term_months: 24,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  transaction_date: new Date().toISOString().slice(0, 10),
  installment_start_date: new Date().toISOString().slice(0, 10),
  installment_end_date: null,
  pay_eom: true,
  payment_type: 'Fix Installment / Fix Installment & Step payment',
  installment: null,
  residual_value: 0,
  include_rv_in_installment: true,
  balloon_option: 'พร้อมค่างวด (รวมในงวดสุดท้าย)',
  effective_rate: null,
  irr_month: null,
  allow_prepayment: 'Yes — รองรับทั้ง Full + Partial',
  prepayment_fee_base: 'Outstanding Principal (หนี้คงเหลือ)',
  rollover_parent_id: null,
  inactive: false,
  payment_freq: 'monthly',
  status: 'Draft',
  remark: null,
  rate_cards: [],
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Approved: 'success',
  Active: 'success',
  Closed: 'default',
  Modified: 'brand',
  Rejected: 'danger',
  Cancelled: 'danger',
};

export function LoanDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [chassis, setChassis] = useState<LoanChassis[]>([]);
  const [showActions, setShowActions] = useState(false);

  // Close actions menu on outside click
  useEffect(() => {
    if (!showActions) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-loan-actions]')) setShowActions(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showActions]);

  const { data: existing } = useQuery({
    queryKey: ['loan', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [m, c] = await Promise.all([
        supabase.from('loans').select('*').eq('id', id!).single(),
        supabase.from('loan_chassis').select('*').eq('loan_id', id!).order('sort_order'),
      ]);
      if (m.error) throw m.error;
      return { main: m.data as Loan, chassis: (c.data ?? []) as LoanChassis[] };
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing.main;
      setForm({
        ...rest,
        rate_cards: existing.main.rate_cards ?? [],
        acct_cards: existing.main.acct_cards ?? [],
      });
      setChassis(existing.chassis);
    }
  }, [existing]);

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-loan'],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .order('ca_name');
      return data ?? [];
    },
  });

  // Auto-sync effective rate from rate_cards
  const effRate = useMemo(
    () => (form.rate_cards.length > 0 ? effectiveRate((form.rate_cards as RateCard[])[0]) : form.annual_rate),
    [form.rate_cards, form.annual_rate],
  );

  useEffect(() => {
    if (Math.abs(effRate - form.annual_rate) > 0.0001) {
      setForm((f) => ({ ...f, annual_rate: effRate, effective_rate: effRate, irr_month: effRate / 12 }));
    }
  }, [effRate]);

  // Auto-compute installment_end_date = installment_start + term_months
  useEffect(() => {
    if (form.installment_start_date && form.term_months) {
      const d = new Date(form.installment_start_date);
      d.setMonth(d.getMonth() + form.term_months);
      d.setDate(d.getDate() - 1);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== form.installment_end_date) setForm((f) => ({ ...f, installment_end_date: iso }));
    }
  }, [form.installment_start_date, form.term_months]);

  // Auto-sync amount → principal
  useEffect(() => {
    if (form.amount && form.amount !== form.principal) {
      setForm((f) => ({ ...f, principal: f.amount ?? 0 }));
    }
  }, [form.amount]);

  const schedule = useMemo(() => {
    if (!form.principal || !form.term_months || !form.installment_start_date) return [];
    try {
      return buildSchedule({
        principal: form.principal,
        annualRate: effRate,
        termMonths: form.term_months,
        startDate: form.installment_start_date,
      });
    } catch {
      return [];
    }
  }, [form.principal, effRate, form.term_months, form.installment_start_date]);

  const monthlyPayment = useMemo(
    () => pmt(form.principal, effRate, form.term_months),
    [form.principal, effRate, form.term_months],
  );
  const totalPay = schedule.reduce((s, r) => s + r.payment, 0);
  const totalInt = schedule.reduce((s, r) => s + r.interest, 0);

  // Save
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, effective_rate: effRate, irr_month: effRate / 12 };
      let lid = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('loans').insert(payload).select().single();
        if (error) throw error;
        lid = data.id;
      } else {
        const { error } = await supabase.from('loans').update(payload).eq('id', lid!);
        if (error) throw error;
      }

      // Replace chassis
      await supabase.from('loan_chassis').delete().eq('loan_id', lid!);
      if (chassis.length > 0) {
        const rows = chassis.map((c, i) => ({
          loan_id: lid!,
          chassis_no: c.chassis_no,
          car_model: c.car_model,
          location: c.location,
          cost: c.cost,
          status: c.status,
          sort_order: i,
        }));
        const { error } = await supabase.from('loan_chassis').insert(rows);
        if (error) throw error;
      }

      // Replace schedule
      await supabase.from('loan_schedules').delete().eq('loan_id', lid!);
      if (schedule.length > 0) {
        const rows = schedule.map((r) => ({
          loan_id: lid!,
          period: r.period,
          due_date: r.date,
          begin_balance: r.beginBalance,
          payment: r.payment,
          interest: r.interest,
          principal: r.principal,
          end_balance: r.endBalance,
        }));
        const { error } = await supabase.from('loan_schedules').insert(rows);
        if (error) throw error;
      }
      return lid;
    },
    onSuccess: (lid: any) => {
      qc.invalidateQueries({ queryKey: ['loan-list'] });
      qc.invalidateQueries({ queryKey: ['loan', lid] });
      toast.success(`บันทึก + Schedule ${schedule.length} งวด`);
      if (mode === 'new' && lid) navigate(`/tx/loan/${lid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ensureLoanId = async (): Promise<string> => {
    if (id) return id;
    const loanNo = (form.loan_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || loanNo;
    const { data, error } = await supabase
      .from('loans')
      .insert({ ...form, loan_no: loanNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['loan-list'] });
    navigate(`/tx/loan/${data.id}`, { replace: true });
    return data.id as string;
  };

  // ============== Tabs ==============
  const tabs: TabDef[] = [
    {
      key: 'interest',
      label: 'Interest Rate',
      render: () => (
        <RateCards
          variant="interest"
          rates={form.rate_cards as RateCard[]}
          onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))}
        />
      ),
    },
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
      key: 'chassis',
      label: 'Chassis',
      render: () => <ChassisTab chassis={chassis} onChange={setChassis} />,
    },
    {
      key: 'sched',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          {/* Indicators */}
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <span className="px-2.5 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800">
              {form.payment_type.split(' / ')[0]}
            </span>
            {form.residual_value > 0 && (
              <span className="px-2.5 py-1 rounded text-xs font-bold bg-red-100 text-red-800">
                Balloon = Yes
              </span>
            )}
            {form.residual_value > 0 && (
              <span className="text-xs text-muted italic">
                งวด {form.term_months} (งวดสุดท้าย) รวม Balloon/RV {fmtMoney(form.residual_value)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="Monthly Payment" value={fmtMoney(monthlyPayment)} highlight />
            <Stat label="จำนวนงวด" value={schedule.length} />
            <Stat label="Total Payment" value={fmtMoney(totalPay)} />
            <Stat label="Total Interest" value={fmtMoney(totalInt)} />
          </div>

          {schedule.length === 0 ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              กรอก Principal / Term / Installment Start Date + เพิ่ม Rate Card เพื่อแสดง schedule
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[520px]">
              <table className="table-base text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <ThTip align="right">Period</ThTip>
                    <ThTip>Start Date</ThTip>
                    <ThTip>End Date</ThTip>
                    <ThTip align="right">Days</ThTip>
                    <ThTip align="right">Installment</ThTip>
                    <ThTip align="right">Principal</ThTip>
                    <ThTip align="right">Interest</ThTip>
                    <ThTip align="right">Principal Balance</ThTip>
                    <ThTip align="right">Interest Balance</ThTip>
                    <ThTip>End of Month</ThTip>
                    <ThTip align="right">Days</ThTip>
                    <ThTip align="right">Accrued</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {/* Period 0 row */}
                  <tr>
                    <td className="text-right tabular-nums font-medium">0</td>
                    <td>{form.installment_start_date ? fmtDate(form.installment_start_date) : '—'}</td>
                    <td className="text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                    <td className="text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                  </tr>
                  {schedule.map((r, idx) => {
                    const isLastPeriod = idx === schedule.length - 1;
                    const isBalloon = isLastPeriod && form.residual_value > 0;
                    const prevDate = idx === 0 ? form.installment_start_date : schedule[idx - 1].date;
                    const startDate = prevDate ?? r.date;
                    const days = prevDate
                      ? Math.round(
                          (new Date(r.date).getTime() - new Date(prevDate).getTime()) / 86400000,
                        )
                      : 0;
                    const eomDate = (() => {
                      const d = new Date(r.date);
                      return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
                    })();
                    // Accrued days: days between r.date and eom (for "pay before EOM" case)
                    const accruedDays = Math.max(
                      0,
                      Math.round((new Date(eomDate).getTime() - new Date(r.date).getTime()) / 86400000),
                    );
                    const accrued = (r.endBalance * effRate * accruedDays) / 100 / 365;
                    const totalInstallment = isBalloon ? r.payment + form.residual_value : r.payment;
                    return (
                      <tr
                        key={r.period}
                        className={isBalloon ? 'bg-amber-50 font-bold' : 'hover:bg-gray-50'}
                      >
                        <td className="text-right tabular-nums font-medium">{r.period}</td>
                        <td>{fmtDate(startDate)}</td>
                        <td>{fmtDate(r.date)}</td>
                        <td className="text-right tabular-nums">{days || '—'}</td>
                        <td className="text-right tabular-nums font-medium">{fmtMoney(totalInstallment)}</td>
                        <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                        <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                        <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                        <td className="text-right tabular-nums">{fmtMoney(Math.max(0, totalInt - schedule.slice(0, idx + 1).reduce((s, p) => s + p.interest, 0)))}</td>
                        <td className="text-xs">{fmtDate(eomDate)}</td>
                        <td className="text-right tabular-nums">{accruedDays || '0'}</td>
                        <td className="text-right tabular-nums">{accrued > 0.01 ? fmtMoney(accrued) : '0.00'}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-soft font-bold border-t-2 border-line">
                    <td colSpan={4} className="text-right">Total</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalPay + form.residual_value)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
            <RowTip label="Effective Interest Rate (%)" value={effRate.toFixed(4)} bold />
            <RowTip label="IRR (Monthly, %)" value={(effRate / 12).toFixed(4)} />
            <RowTip label="Term (Periods)" value={form.term_months} />
            <RowTip label="Installment" value={fmtMoney(monthlyPayment)} bold />
          </div>
          <div className="overflow-x-auto max-w-3xl">
            <table className="table-base">
              <thead>
                <tr className="bg-brand text-white">
                  <th className="!text-white !bg-brand">Actual</th>
                  <th className="!text-white !bg-brand text-right">Total</th>
                  <th className="!text-white !bg-brand text-right">Repayment</th>
                  <th className="!text-white !bg-brand text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">Principal</td>
                  <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                </tr>
                <tr>
                  <td className="font-semibold">Interest</td>
                  <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ),
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
                Loan
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureLoanId}
              bucketName="loan-documents"
              tableName="loan_documents"
              parentFkColumn="loan_id"
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
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/loan')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Loan
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Loan' : (form.name ?? form.loan_no)}
          </p>
        </div>
        {/* Actions dropdown */}
        <div className="relative" data-loan-actions>
          <Button
            onClick={() => setShowActions((s) => !s)}
            disabled={!id}
            title={!id ? 'Save ก่อน' : 'Loan Actions'}
            className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800"
          >
            ↩ Actions <ChevronDown className="w-3 h-3" />
          </Button>
          {showActions && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-line rounded shadow-lg z-50 min-w-[240px]">
              <button
                onClick={() => { toast.info('🚧 Modify Loan Condition — coming soon'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="แก้ไขเงื่อนไข Loan ระหว่างทาง (Close + Reopen หรือ Change Condition)"
              >
                📝 Modify Loan Condition
              </button>
              <button
                onClick={() => { toast.info('🚧 Full Prepayment — coming soon'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="ปิดยอด Outstanding ทั้งหมดก่อนกำหนด (อาจมี Prepayment Fee)"
              >
                💰 Full Prepayment
              </button>
              <button
                onClick={() => { toast.info('🚧 Partial Prepayment — coming soon'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="ชำระเงินต้นเพิ่มบางส่วน → re-amortize (อาจมี Prepayment Fee)"
              >
                💵 Partial Prepayment
              </button>
              <button
                onClick={() => { navigate('/tx/repayment/new'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="บันทึกการชำระงวดปกติตาม Schedule"
              >
                ↩ Make Regular Repayment
              </button>
              <button
                onClick={() => { toast.info('🚧 Close Loan — ต้องชำระครบก่อน'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft text-danger"
                title="ปิดสัญญา Loan — เฉพาะกรณีชำระครบ"
              >
                ✗ Close Loan
              </button>
            </div>
          )}
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save + Schedule'}
        </Button>
        <Button onClick={() => navigate('/tx/loan')}>Cancel</Button>
      </div>

      {/* Primary Information (3-col) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, ca_id: e.target.value || null }))}
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
              <FieldLabel tipKey="LOAN NAME">NAME</FieldLabel>
              <Input
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value || null }))}
                placeholder="Loan Fixed-001"
              />
            </div>
            <div>
              <FieldLabel required tipKey="LOAN NUMBER">LOAN NUMBER</FieldLabel>
              <Input
                value={form.loan_no}
                onChange={(e) => setForm((f) => ({ ...f, loan_no: e.target.value }))}
                placeholder="LN-FX-001"
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
              <FieldLabel required>AMOUNT (THB)</FieldLabel>
              <NumInput value={form.amount ?? 0} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>CURRENCY</FieldLabel>
              <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>AMOUNT (FOREIGN)</FieldLabel>
              <NumInput
                value={form.amount_foreign ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, amount_foreign: v }))}
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
              <FieldLabel>CONVERSION RATE</FieldLabel>
              <NumInput
                value={form.conversion_rate ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, conversion_rate: v }))}
              />
            </div>
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="Loan" className="bg-gray-50" />
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as LoanStatus }))}>
                {LOAN_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {FINANCE_INSTITUTIONS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea
                className="input min-h-[120px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุ"
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Schedule Information (3-col) */}
      <Section title="Schedule Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="START DATE">START DATE</FieldLabel>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel required>INSTALLMENT START DATE</FieldLabel>
              <Input
                type="date"
                value={form.installment_start_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, installment_start_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel>INSTALLMENT END DATE</FieldLabel>
              <Input
                type="date"
                value={form.installment_end_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, installment_end_date: e.target.value || null }))}
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Installment Start Date + Term (Months)</p>
            </div>
            <label className="flex items-center gap-2 text-sm mt-2">
              <input
                type="checkbox"
                checked={form.pay_eom}
                onChange={(e) => setForm((f) => ({ ...f, pay_eom: e.target.checked }))}
              />
              <FieldLabel>PAY AT END OF MONTH</FieldLabel>
            </label>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel tipKey="TERM (MONTHS)">TERM (MONTHS)</FieldLabel>
              <NumInput value={form.term_months ?? 0} onChange={(v) => setForm((f) => ({ ...f, term_months: v }))} />
            </div>
            <div>
              <FieldLabel>PAYMENT TYPE</FieldLabel>
              <Select
                value={form.payment_type}
                onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}
              >
                {PAYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>INSTALLMENT</FieldLabel>
              <NumInput
                value={form.installment ?? monthlyPayment}
                onChange={(v) => setForm((f) => ({ ...f, installment: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = PMT(Principal, Rate, Term)</p>
            </div>
            <div>
              <FieldLabel>PRINCIPAL</FieldLabel>
              <NumInput
                value={form.principal}
                onChange={(v) => setForm((f) => ({ ...f, principal: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = AMOUNT (THB)</p>
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>RESIDUAL VALUE (RV)</FieldLabel>
              <NumInput
                value={form.residual_value}
                onChange={(v) => setForm((f) => ({ ...f, residual_value: v }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.include_rv_in_installment}
                onChange={(e) => setForm((f) => ({ ...f, include_rv_in_installment: e.target.checked }))}
              />
              <FieldLabel>INCLUDE RV IN INSTALLMENT</FieldLabel>
            </label>
            <div>
              <FieldLabel>BALLOON OPTION</FieldLabel>
              <Select
                value={form.balloon_option ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, balloon_option: e.target.value || null }))}
              >
                {BALLOON_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel tipKey="EFFECTIVE INTEREST RATE">EFFECTIVE INTEREST RATE / YEAR (%)</FieldLabel>
              <Input
                readOnly
                value={effRate.toFixed(4) + '%'}
                className="bg-gray-50 text-right tabular-nums font-semibold text-brand"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">จาก Rate Cards (Interest Rate tab)</p>
            </div>
            <div>
              <FieldLabel>IRR / MONTH (%)</FieldLabel>
              <Input
                readOnly
                value={(effRate / 12).toFixed(4) + '%'}
                className="bg-gray-50 text-right tabular-nums"
              />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted mt-3 italic">
          💡 ตัวอย่าง: Term Loan {form.term_months} เดือน · {form.payment_type.split(' / ')[0]} · ผ่อนเดือนละ {fmtMoney(monthlyPayment)} บาท
          {form.residual_value > 0 ? ` · Residual Value ${fmtMoney(form.residual_value)} (รวมในงวด)` : ''}
        </p>
      </Section>

      {/* Prepayment Configuration */}
      <Section title="Prepayment Configuration">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>ALLOW PREPAYMENT</FieldLabel>
            <Select
              value={form.allow_prepayment}
              onChange={(e) => setForm((f) => ({ ...f, allow_prepayment: e.target.value }))}
            >
              <option>Yes — รองรับทั้ง Full + Partial</option>
              <option>Full Only</option>
              <option>Partial Only</option>
              <option>No</option>
            </Select>
          </div>
          <div>
            <FieldLabel tipKey="FEE BASE">FEE BASE</FieldLabel>
            <Select
              value={form.prepayment_fee_base}
              onChange={(e) => setForm((f) => ({ ...f, prepayment_fee_base: e.target.value }))}
            >
              <option>Outstanding Principal (หนี้คงเหลือ)</option>
              <option>Prepayment Amount (ยอดที่ชำระคืน)</option>
            </Select>
          </div>
          <div className="md:col-span-3 text-[11px] text-muted italic">
            💡 รายละเอียด Prepayment Fee Rate Card (per tier) — ทำใน CA / ภายหลัง
          </div>
        </div>
      </Section>

      <div className="mt-4">
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
}

// ============== Chassis Tab — Modal Lookup (PN-style) ==============
function ChassisTab({ chassis, onChange }: { chassis: LoanChassis[]; onChange: (n: LoanChassis[]) => void }) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const usedChassisNos = new Set(chassis.map((c) => c.chassis_no));
  const filtered = MOCK_INVENTORY.filter((c) => {
    if (usedChassisNos.has(c.chassis_no)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.chassis_no.toLowerCase().includes(q) ||
      c.car_model.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q)
    );
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onConfirm = () => {
    const picked = MOCK_INVENTORY.filter((c) => selected.has(c.id)).map<LoanChassis>((c) => ({
      id: crypto.randomUUID(),
      loan_id: '',
      chassis_no: c.chassis_no,
      car_model: c.car_model,
      location: c.location,
      cost: c.cost,
      status: 'Active',
      sort_order: chassis.length,
    }));
    onChange([...chassis, ...picked]);
    setSelected(new Set());
    setLookupOpen(false);
    setSearch('');
  };

  const remove = (i: number) => onChange(chassis.filter((_, j) => j !== i));

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 Chassis ดึงจาก NetSuite Inventory (mock) · 1 Chassis ผูกได้ 1 Facility เท่านั้น
        </p>
        <Button variant="primary" onClick={() => setLookupOpen(true)}>
          🔍 Lookup Chassis
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>Chassis No.</ThTip>
              <ThTip>Car Model</ThTip>
              <ThTip>Location</ThTip>
              <ThTip align="right">Cost (THB)</ThTip>
              <ThTip>Status</ThTip>
              <ThTip>Action</ThTip>
            </tr>
          </thead>
          <tbody>
            {chassis.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-6 italic">
                  ยังไม่มี Chassis — กด <strong>🔍 Lookup Chassis</strong>
                </td>
              </tr>
            )}
            {chassis.map((c, i) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.chassis_no}</td>
                <td>{c.car_model ?? '—'}</td>
                <td>{c.location ?? '—'}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.cost)}</td>
                <td><Badge variant="success">{c.status}</Badge></td>
                <td>
                  <button onClick={() => remove(i)} className="text-danger hover:underline text-xs">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Lookup Modal ── */}
      <Modal
        open={lookupOpen}
        onClose={() => {
          setLookupOpen(false);
          setSelected(new Set());
        }}
        title="🔍 Lookup Chassis — NetSuite Inventory"
        size="xl"
        footer={
          <>
            <Button onClick={() => setLookupOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm} disabled={selected.size === 0}>
              Add Selected ({selected.size})
            </Button>
          </>
        }
      >
        <div className="mb-3">
          <Input
            placeholder="🔍 ค้นหา Chassis No / Model / Location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted mb-3 italic">
          💡 Mock data — ระบบจริงจะดึงจาก NetSuite Inventory · 1 Chassis ผูกได้ 1 Facility
        </p>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="table-base">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="w-10"></th>
                <ThTip>Chassis No.</ThTip>
                <ThTip>Car Model</ThTip>
                <ThTip>Location</ThTip>
                <ThTip align="right">Cost (THB)</ThTip>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-6">
                    {usedChassisNos.size === MOCK_INVENTORY.length
                      ? 'Chassis ทั้งหมดถูกผูกแล้ว'
                      : 'ไม่พบ Chassis ตามเงื่อนไข'}
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={selected.has(c.id) ? 'bg-brand-light' : 'hover:bg-gray-50 cursor-pointer'}
                  onClick={() => toggleSelect(c.id)}
                >
                  <td>
                    <input type="checkbox" checked={selected.has(c.id)} readOnly />
                  </td>
                  <td className="font-mono text-xs">{c.chassis_no}</td>
                  <td>{c.car_model}</td>
                  <td>{c.location}</td>
                  <td className="text-right tabular-nums">{fmtMoney(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="!py-3">
        <div className="text-xs text-muted">{label}</div>
        <div className={`text-lg font-semibold tabular-nums ${highlight ? 'text-brand' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// Mock chassis inventory (NetSuite — Aliyan)
const MOCK_INVENTORY: { id: string; chassis_no: string; car_model: string; location: string; cost: number }[] = [
  { id: 'inv-l-1', chassis_no: 'MMTFR86A8RH001238', car_model: 'MINI Cooper S 5DR',   location: 'MAG Phaholyothin', cost: 2_390_000 },
  { id: 'inv-l-2', chassis_no: 'WBA8E5C50JG924765', car_model: 'BMW 320i M Sport',     location: 'MAG Rama 9',        cost: 1_800_000 },
  { id: 'inv-l-3', chassis_no: 'WMW7D5108K5K12345', car_model: 'MINI Cooper Country',  location: 'MAG Bangna',        cost: 1_650_000 },
  { id: 'inv-l-4', chassis_no: 'WBAJB4C50KBV98762', car_model: 'BMW 530e M Sport',     location: 'MAG HQ Showroom',   cost: 3_450_000 },
  { id: 'inv-l-5', chassis_no: 'WAUE8AF44LA011234', car_model: 'Audi A6 45 TFSI',      location: 'MAG Lat Phrao',     cost: 3_290_000 },
  { id: 'inv-l-6', chassis_no: 'JHMFC1F70KX021234', car_model: 'Honda Civic RS',       location: 'MAG Rangsit',       cost: 1_090_000 },
];
