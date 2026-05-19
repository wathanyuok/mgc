import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select } from '@/components/ui';
import { type Curtailment, VENDORS, VEHICLE_TYPES } from '@/types/database';

type CurtailmentForm = Omit<Curtailment, 'id' | 'created_at' | 'updated_at'>;

const blank: CurtailmentForm = {
  vendor: VENDORS[0],
  vehicle_type: VEHICLE_TYPES[0],
  effective_start_date: new Date().toISOString().slice(0, 10),
  effective_end_date: null,
  tier1_days: null,
  tier1_pct: null,
  tier2_days: null,
  tier2_pct: null,
  tier3_days: null,
  tier3_pct: null,
  status: 'Active',
  remark: null,
};

export function CurtailmentDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<CurtailmentForm>(blank);

  const { data: existing } = useQuery({
    queryKey: ['curt', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('curtailments').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Curtailment;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm(rest);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'new') {
        const { data, error } = await supabase.from('curtailments').insert(form).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('curtailments')
          .update(form)
          .eq('id', id!)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['curt-list'] });
      toast.success(mode === 'new' ? 'สร้าง Curtailment แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/curtailment/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const title = mode === 'new' ? '+ New Curtailment' : `${form.vendor} — ${form.vehicle_type}`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/master/curtailment')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Curtailment</h1>
          <p className="text-muted text-sm font-medium">{title}</p>
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/master/curtailment')}>Cancel</Button>
      </div>

      <Card className="mb-4">
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label">VENDOR *</label>
              <Select value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}>
                {VENDORS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">TYPE *</label>
              <Select
                value={form.vehicle_type}
                onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value }))}
              >
                {VEHICLE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
            <div>
              <label className="field-label">EFFECTIVE START DATE *</label>
              <Input
                type="date"
                value={form.effective_start_date}
                onChange={(e) => setForm((f) => ({ ...f, effective_start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">EFFECTIVE END DATE</label>
              <Input
                type="date"
                value={form.effective_end_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, effective_end_date: e.target.value || null }))}
              />
            </div>
            <div />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Curtailment Tiers</h3>
          <p className="text-xs text-muted mb-4">
            ระยะเวลาที่ครบกำหนดผ่อนชำระตามเงื่อนไข Floor Plan (วันนับจากวันรับสินค้า) และเปอร์เซ็นต์ที่ต้องชำระ
          </p>
          <table className="table-base">
            <thead>
              <tr>
                <th></th>
                <th className="text-right">Days</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3] as const).map((tier) => {
                const daysKey = `tier${tier}_days` as const;
                const pctKey = `tier${tier}_pct` as const;
                return (
                  <tr key={tier}>
                    <td className="font-medium">
                      {tier === 1 ? '1st' : tier === 2 ? '2nd' : '3rd'} Curtailment
                    </td>
                    <td>
                      <Input
                        type="number"
                        value={form[daysKey] ?? ''}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [daysKey]: e.target.value ? parseInt(e.target.value) : null,
                          }))
                        }
                        className="text-right tabular-nums"
                        placeholder="180"
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        step="0.01"
                        value={form[pctKey] ?? ''}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [pctKey]: e.target.value ? parseFloat(e.target.value) : null,
                          }))
                        }
                        className="text-right tabular-nums"
                        placeholder="15"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-soft">
                <td className="font-semibold">Total %</td>
                <td></td>
                <td className="text-right tabular-nums font-semibold">
                  {((form.tier1_pct ?? 0) + (form.tier2_pct ?? 0) + (form.tier3_pct ?? 0)).toFixed(2)}%
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-4">
            <label className="field-label">REMARK</label>
            <textarea
              className="input min-h-[80px]"
              value={form.remark ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
              placeholder="หมายเหตุ..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
