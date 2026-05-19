import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { buildSchedule, pmt } from '@/lib/lease-calc';
import { type Loan, FINANCE_INSTITUTIONS } from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';

type Form = Omit<Loan, 'id' | 'created_at' | 'updated_at'> & {
  rate_cards: RateCard[];
  acct_cards: AcctCard[];
};

const blank: Form = {
  loan_no: '', ca_id: null, finance_institution: 'KBANK',
  principal: 0, annual_rate: 5.5, term_months: 60,
  start_date: new Date().toISOString().slice(0, 10), end_date: null,
  payment_freq: 'monthly', status: 'Draft', remark: null,
  rate_cards: [], acct_cards: [],
};

export function LoanDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);

  const { data: existing } = useQuery({
    queryKey: ['loan', id], enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('loans').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm({ ...rest, rate_cards: existing.rate_cards ?? [], acct_cards: existing.acct_cards ?? [] });
    }
  }, [existing]);

  // Auto-sync annual_rate from first rate card if present
  useEffect(() => {
    if (form.rate_cards.length > 0) {
      const eff = effectiveRate(form.rate_cards[0]);
      if (Math.abs(eff - form.annual_rate) > 0.0001) setForm((f) => ({ ...f, annual_rate: eff }));
    }
  }, [form.rate_cards]);

  const schedule = useMemo(() => {
    if (!form.principal || !form.term_months || !form.start_date) return [];
    try {
      return buildSchedule({
        principal: form.principal,
        annualRate: form.annual_rate,
        termMonths: form.term_months,
        startDate: form.start_date,
      });
    } catch { return []; }
  }, [form.principal, form.annual_rate, form.term_months, form.start_date]);

  const monthly = useMemo(() => pmt(form.principal, form.annual_rate, form.term_months), [form.principal, form.annual_rate, form.term_months]);
  const totalPay = schedule.reduce((s, r) => s + r.payment, 0);
  const totalInt = schedule.reduce((s, r) => s + r.interest, 0);

  const save = useMutation({
    mutationFn: async () => {
      const sd = new Date(form.start_date); sd.setMonth(sd.getMonth() + form.term_months);
      const payload = { ...form, end_date: sd.toISOString().slice(0, 10) };

      let lid = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('loans').insert(payload).select().single();
        if (error) throw error; lid = data.id;
      } else {
        const { error } = await supabase.from('loans').update(payload).eq('id', lid!);
        if (error) throw error;
      }

      await supabase.from('loan_schedules').delete().eq('loan_id', lid!);
      if (schedule.length > 0) {
        const rows = schedule.map((r) => ({
          loan_id: lid!, period: r.period, due_date: r.date,
          begin_balance: r.beginBalance, payment: r.payment,
          interest: r.interest, principal: r.principal, end_balance: r.endBalance,
        }));
        const { error } = await supabase.from('loan_schedules').insert(rows);
        if (error) throw error;
      }
      return lid;
    },
    onSuccess: (lid: any) => {
      qc.invalidateQueries({ queryKey: ['loan-list'] });
      toast.success(`บันทึก + Schedule ${schedule.length} งวด`);
      if (mode === 'new' && lid) navigate(`/tx/loan/${lid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tabs: TabDef[] = [
    {
      key: 'interest', label: 'Interest Rate',
      render: () => <RateCards rates={form.rate_cards} onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))} />,
    },
    {
      key: 'accounting', label: 'Accounting',
      render: () => <AcctCards accounts={form.acct_cards} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} />,
    },
    {
      key: 'schedule', label: 'Amortization Schedule',
      render: () => (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="Monthly Payment" value={fmtMoney(monthly)} highlight />
            <Stat label="จำนวนงวด" value={schedule.length} />
            <Stat label="Total Payment" value={fmtMoney(totalPay)} />
            <Stat label="Total Interest" value={fmtMoney(totalInt)} />
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="table-base">
              <thead className="sticky top-0"><tr><th>#</th><th>Due Date</th><th className="text-right">Begin</th><th className="text-right">Payment</th><th className="text-right">Interest</th><th className="text-right">Principal</th><th className="text-right">End</th></tr></thead>
              <tbody>{schedule.map((r) => (
                <tr key={r.period} className="hover:bg-gray-50">
                  <td className="font-medium">{r.period}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.beginBalance)}</td>
                  <td className="text-right tabular-nums font-medium">{fmtMoney(r.payment)}</td>
                  <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      key: 'docs', label: 'Document',
      render: () => <div className="text-center py-12 text-muted"><div className="text-3xl mb-2">📎</div><p>File upload — coming Phase 2</p></div>,
    },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/loan')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1"><h1 className="text-2xl font-bold">Loan</h1><p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New Loan' : form.loan_no}</p></div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save + Schedule'}</Button>
        <Button onClick={() => navigate('/tx/loan')}>Cancel</Button>
      </div>

      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="field-label">LOAN NO *</label><Input value={form.loan_no} onChange={(e) => setForm((f) => ({ ...f, loan_no: e.target.value }))} placeholder="LN-2024-001" /></div>
          <div><label className="field-label">FINANCE INSTITUTION *</label>
            <Select value={form.finance_institution} onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}>
              {FINANCE_INSTITUTIONS.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
          <div><label className="field-label">STATUS *</label>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option>Draft</option><option>Active</option><option>Closed</option><option>Modified</option>
            </Select>
          </div>
          <div><label className="field-label">PRINCIPAL *</label><Input type="number" step="0.01" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">ANNUAL RATE (%)</label><Input type="number" step="0.0001" value={form.annual_rate} onChange={(e) => setForm((f) => ({ ...f, annual_rate: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">TERM (MONTHS)</label><Input type="number" value={form.term_months} onChange={(e) => setForm((f) => ({ ...f, term_months: parseInt(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">START DATE *</label><Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
          <div><label className="field-label">PAYMENT FREQUENCY</label>
            <Select value={form.payment_freq} onChange={(e) => setForm((f) => ({ ...f, payment_freq: e.target.value }))}>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
            </Select>
          </div>
          <div />
          <div className="md:col-span-3"><label className="field-label">REMARK</label><textarea className="input min-h-[80px]" value={form.remark ?? ''} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))} /></div>
        </div>
      </Section>

      <Tabs tabs={tabs} defaultTab="interest" />
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
