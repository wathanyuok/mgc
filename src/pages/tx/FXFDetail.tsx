import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { type FXForward, FINANCE_INSTITUTIONS } from '@/types/database';

type Form = Omit<FXForward, 'id' | 'created_at' | 'updated_at'>;
const blank: Form = {
  fxf_no: '', ca_id: null, finance_institution: 'KBANK',
  deal_date: new Date().toISOString().slice(0, 10), value_date: new Date().toISOString().slice(0, 10),
  direction: 'Buy', ccy_buy: 'USD', ccy_sell: 'THB', amount_buy: 0, amount_sell: 0,
  spot_rate: null, forward_rate: 0, swap_points: null,
  status: 'Draft', remark: null,
};

export function FXFDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);

  const { data: existing } = useQuery({
    queryKey: ['fxf', id], enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('fx_forwards').select('*').eq('id', id!).single();
      if (error) throw error; return data as FXForward;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm(rest);
    }
  }, [existing]);

  // Auto-compute amount_sell = amount_buy * forward_rate (or vice versa for Sell)
  useEffect(() => {
    if (form.amount_buy && form.forward_rate) {
      const expectedSell = form.amount_buy * form.forward_rate;
      if (Math.abs(expectedSell - form.amount_sell) > 0.01) {
        setForm((f) => ({ ...f, amount_sell: parseFloat(expectedSell.toFixed(2)) }));
      }
    }
  }, [form.amount_buy, form.forward_rate]);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'new') {
        const { data, error } = await supabase.from('fx_forwards').insert(form).select().single();
        if (error) throw error; return data;
      }
      const { data, error } = await supabase.from('fx_forwards').update(form).eq('id', id!).select().single();
      if (error) throw error; return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['fxf-list'] });
      toast.success(mode === 'new' ? 'สร้าง FX Forward แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/tx/fxf/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/fxf')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1"><h1 className="text-2xl font-bold">FX Forward Rate</h1><p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New' : form.fxf_no}</p></div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="w-4 h-4" /> Save</Button>
        <Button onClick={() => navigate('/tx/fxf')}>Cancel</Button>
      </div>

      <Card><CardContent>
        <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><FieldLabel required tipKey="BANK REFERENCE">BANK REFERENCE (Deal Ref)</FieldLabel><Input value={form.fxf_no} onChange={(e) => setForm((f) => ({ ...f, fxf_no: e.target.value }))} placeholder="FXF-2024-001" /></div>
          <div><label className="field-label">FINANCE INSTITUTION *</label>
            <Select value={form.finance_institution} onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}>
              {FINANCE_INSTITUTIONS.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
          <div><label className="field-label">STATUS *</label>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option>Draft</option><option>Active</option><option>Settled</option><option>Cancelled</option>
            </Select>
          </div>

          <div><label className="field-label">DIRECTION *</label>
            <Select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as any }))}>
              <option>Buy</option><option>Sell</option>
            </Select>
          </div>
          <div><label className="field-label">DEAL DATE *</label><Input type="date" value={form.deal_date} onChange={(e) => setForm((f) => ({ ...f, deal_date: e.target.value }))} /></div>
          <div><label className="field-label">VALUE DATE *</label><Input type="date" value={form.value_date} onChange={(e) => setForm((f) => ({ ...f, value_date: e.target.value }))} /></div>

          <div><label className="field-label">CCY BUY *</label>
            <Select value={form.ccy_buy} onChange={(e) => setForm((f) => ({ ...f, ccy_buy: e.target.value }))}>
              <option>USD</option><option>EUR</option><option>JPY</option><option>THB</option>
            </Select>
          </div>
          <div><label className="field-label">CCY SELL *</label>
            <Select value={form.ccy_sell} onChange={(e) => setForm((f) => ({ ...f, ccy_sell: e.target.value }))}>
              <option>THB</option><option>USD</option><option>EUR</option><option>JPY</option>
            </Select>
          </div>
          <div />

          <div><label className="field-label">AMOUNT BUY</label><Input type="number" step="0.0001" value={form.amount_buy} onChange={(e) => setForm((f) => ({ ...f, amount_buy: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">FORWARD RATE *</label><Input type="number" step="0.000001" value={form.forward_rate} onChange={(e) => setForm((f) => ({ ...f, forward_rate: parseFloat(e.target.value) || 0 }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">AMOUNT SELL (auto)</label><Input type="number" step="0.01" value={form.amount_sell} onChange={(e) => setForm((f) => ({ ...f, amount_sell: parseFloat(e.target.value) || 0 }))} className="bg-gray-50 text-right tabular-nums" /></div>

          <div><label className="field-label">SPOT RATE</label><Input type="number" step="0.000001" value={form.spot_rate ?? ''} onChange={(e) => setForm((f) => ({ ...f, spot_rate: e.target.value ? parseFloat(e.target.value) : null }))} className="text-right tabular-nums" /></div>
          <div><label className="field-label">SWAP POINTS</label><Input type="number" step="0.000001" value={form.swap_points ?? ''} onChange={(e) => setForm((f) => ({ ...f, swap_points: e.target.value ? parseFloat(e.target.value) : null }))} className="text-right tabular-nums" /></div>
          <div />

          <div className="md:col-span-3"><label className="field-label">REMARK</label><textarea className="input min-h-[80px]" value={form.remark ?? ''} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))} /></div>
        </div>
      </CardContent></Card>
    </div>
  );
}
