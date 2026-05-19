import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { type Repayment, FACILITY_TYPES } from '@/types/database';

type Form = Omit<Repayment, 'id' | 'created_at' | 'updated_at'>;
const blank: Form = {
  repayment_no: '', facility_type: 'PN', facility_id: '',
  pay_date: new Date().toISOString().slice(0, 10),
  amount: 0, principal: 0, interest: 0, fee: 0, vat: 0, wht: 0,
  channel: 'Bank Statement', reference_no: null, remark: null,
  status: 'Posted',
};

interface FacilityOption { id: string; label: string; }

export function RepaymentDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);

  // Load facility options when facility_type changes
  const { data: facilityOpts } = useQuery({
    queryKey: ['facility-opts', form.facility_type],
    queryFn: async () => {
      const tableMap: Record<string, [string, string]> = {
        PN: ['promissory_notes', 'name'],
        LG: ['letter_guarantees', 'lg_no'],
        BG: ['letter_guarantees', 'lg_no'],
        FP: ['floor_plans', 'fp_no'],
        OD: ['overdrafts', 'od_no'],
        TR: ['trust_receipts', 'tr_no'],
        FXF: ['fx_forwards', 'fxf_no'],
        Loan: ['loans', 'loan_no'],
        Lease: ['leases', 'lease_no'],
        HP: ['leases', 'lease_no'],
      };
      const [table, labelCol] = tableMap[form.facility_type] ?? ['', ''];
      if (!table) return [];
      const { data, error } = await supabase.from(table).select(`id, ${labelCol}`);
      if (error) return [];
      return (data ?? []).map((r: any) => ({ id: r.id, label: r[labelCol] })) as FacilityOption[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['rep', id], enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('repayments').select('*').eq('id', id!).single();
      if (error) throw error; return data as Repayment;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm(rest);
    }
  }, [existing]);

  // Auto-sum amount = principal + interest + fee + vat - wht
  useEffect(() => {
    const total = form.principal + form.interest + form.fee + form.vat - form.wht;
    if (Math.abs(total - form.amount) > 0.01) {
      setForm((f) => ({ ...f, amount: parseFloat(total.toFixed(2)) }));
    }
  }, [form.principal, form.interest, form.fee, form.vat, form.wht]);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'new') {
        const { data, error } = await supabase.from('repayments').insert(form).select().single();
        if (error) throw error; return data;
      }
      const { data, error } = await supabase.from('repayments').update(form).eq('id', id!).select().single();
      if (error) throw error; return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      toast.success(mode === 'new' ? 'สร้าง Repayment แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/tx/repayment/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/repayment')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1"><h1 className="text-2xl font-bold">Repayment</h1><p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New' : form.repayment_no}</p></div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="w-4 h-4" /> Save</Button>
        <Button onClick={() => navigate('/tx/repayment')}>Cancel</Button>
      </div>

      <Card className="mb-4"><CardContent>
        <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="field-label">REPAYMENT NO *</label><Input value={form.repayment_no} onChange={(e) => setForm((f) => ({ ...f, repayment_no: e.target.value }))} placeholder="RP-2024-001" /></div>
          <div><label className="field-label">STATUS *</label>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option>Draft</option><option>Posted</option><option>Reversed</option>
            </Select>
          </div>
          <div><label className="field-label">PAY DATE *</label><Input type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))} /></div>

          <div><label className="field-label">FACILITY TYPE *</label>
            <Select value={form.facility_type} onChange={(e) => setForm((f) => ({ ...f, facility_type: e.target.value as any, facility_id: '' }))}>
              {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </div>
          <div className="md:col-span-2"><label className="field-label">FACILITY *</label>
            <Select value={form.facility_id} onChange={(e) => setForm((f) => ({ ...f, facility_id: e.target.value }))}>
              <option value="">— เลือก {form.facility_type} —</option>
              {(facilityOpts ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </div>

          <div><label className="field-label">CHANNEL</label>
            <Select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
              <option>Bank Statement</option>
              <option>AP Module</option>
              <option>Cash</option>
              <option>Cheque</option>
            </Select>
          </div>
          <div><label className="field-label">REFERENCE NO</label><Input value={form.reference_no ?? ''} onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value || null }))} /></div>
          <div />
        </div>
      </CardContent></Card>

      <Card><CardContent>
        <h3 className="font-semibold text-sm tracking-wide mb-4">Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="field-label">PRINCIPAL</label><Input type="number" step="0.01" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">INTEREST</label><Input type="number" step="0.01" value={form.interest} onChange={(e) => setForm((f) => ({ ...f, interest: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">FEE</label><Input type="number" step="0.01" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">VAT</label><Input type="number" step="0.01" value={form.vat} onChange={(e) => setForm((f) => ({ ...f, vat: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">WHT (หัก ณ ที่จ่าย)</label><Input type="number" step="0.01" value={form.wht} onChange={(e) => setForm((f) => ({ ...f, wht: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">TOTAL AMOUNT (auto)</label><Input readOnly value={fmtMoney(form.amount)} className="bg-gray-50 text-right tabular-nums font-semibold text-brand" /></div>
        </div>
        <p className="text-xs text-muted mt-3">Amount = Principal + Interest + Fee + VAT − WHT</p>

        <div className="mt-4">
          <label className="field-label">REMARK</label>
          <textarea className="input min-h-[80px]" value={form.remark ?? ''} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))} />
        </div>
      </CardContent></Card>
    </div>
  );
}
